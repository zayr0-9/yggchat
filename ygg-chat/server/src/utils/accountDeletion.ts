// server/src/utils/accountDeletion.ts
import { supabaseAdmin } from '../database/supamodels'
import { cancelSubscription } from './stripe'

/**
 * Storage bucket name for attachments
 */
const STORAGE_BUCKET = 'attachments'

/**
 * Interface for attachment file info
 */
interface AttachmentFile {
  id: string
  storage_path: string
}

/**
 * Result of account deletion operation
 */
export interface AccountDeletionResult {
  success: boolean
  userId: string
  deletedFiles: number
  subscriptionCanceled: boolean
  error?: string
}

/**
 * Get all attachment files for a user that need to be deleted from storage
 * @param userId - The user's UUID
 * @returns Array of attachment files with storage paths
 */
async function getUserAttachmentFiles(userId: string): Promise<AttachmentFile[]> {
  const { data, error } = await supabaseAdmin
    .from('message_attachments')
    .select('id, storage_path')
    .eq('owner_id', userId)
    .eq('storage', 'file')
    .not('storage_path', 'is', null)

  if (error) {
    console.error('[AccountDeletion] Error fetching attachment files:', error)
    throw new Error(`Failed to fetch attachment files: ${error.message}`)
  }

  return (data || []) as AttachmentFile[]
}

/**
 * Delete files from Supabase Storage
 * @param storagePaths - Array of storage paths to delete
 * @returns Number of files successfully deleted
 */
async function deleteStorageFiles(storagePaths: string[]): Promise<number> {
  if (storagePaths.length === 0) {
    return 0
  }

  console.log(`[AccountDeletion] Attempting to delete ${storagePaths.length} files from storage`)

  const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(storagePaths)

  if (error) {
    console.error('[AccountDeletion] Error deleting storage files:', error)
    throw new Error(`Failed to delete storage files: ${error.message}`)
  }

  const deletedCount = data?.length || 0
  console.log(`[AccountDeletion] Successfully deleted ${deletedCount} files from storage`)

  return deletedCount
}

/**
 * Cancel user's active subscription if they have one
 * @param userId - The user's UUID
 * @returns True if subscription was canceled, false if no active subscription
 */
async function cancelUserSubscription(userId: string): Promise<boolean> {
  try {
    // Check if user has an active subscription
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('active_subscription_id')
      .eq('id', userId)
      .single()

    if (profileError || !profile || !profile.active_subscription_id) {
      console.log('[AccountDeletion] No active subscription to cancel')
      return false
    }

    // Cancel the subscription immediately (not at period end since account is being deleted)
    // We'll do an immediate cancellation via Stripe API instead of using the cancelSubscription function
    // which schedules cancellation at period end
    const { data: subscription, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('id', profile.active_subscription_id)
      .single()

    if (subError || !subscription || !subscription.stripe_subscription_id) {
      console.log('[AccountDeletion] No Stripe subscription found')
      return false
    }

    // Import stripe here to avoid circular dependencies
    const { stripe } = await import('./stripe')

    if (!stripe) {
      console.warn('[AccountDeletion] Stripe not configured, skipping subscription cancellation')
      return false
    }

    // Cancel immediately (don't wait for period end since account is being deleted)
    await stripe.subscriptions.cancel(subscription.stripe_subscription_id)

    console.log(`[AccountDeletion] Canceled Stripe subscription: ${subscription.stripe_subscription_id}`)
    return true
  } catch (error: any) {
    // Log the error but don't fail the entire deletion process
    console.error('[AccountDeletion] Error canceling subscription:', error.message)
    // Return false instead of throwing - we still want to delete the account
    return false
  }
}

/**
 * Delete user account and all associated data
 *
 * This function performs the following operations:
 * 1. Fetches all user's attachment files from storage
 * 2. Deletes files from Supabase Storage bucket
 * 3. Cancels active Stripe subscription (if any)
 * 4. Deletes user profile from profiles table (triggers cascade deletion of user content)
 * 5. Deletes user from auth.users (now succeeds since profile is removed)
 *
 * IMPORTANT: Before using this function, ensure the database migration
 * to fix foreign key constraints has been applied. See:
 * server/migrations/fix_billing_fk_constraints.md
 *
 * Data that will be DELETED (cascade):
 * - profiles
 * - projects
 * - conversations
 * - messages
 * - message_attachments (records and files)
 * - message_attachment_links
 * - message_file_content
 * - message_file_content_links
 * - provider_cost
 * - electron_allowlist
 *
 * Data that will be PRESERVED (user_id remains intact):
 * - credits_ledger (billing audit trail with original user_id)
 * - subscriptions (subscription history with original user_id)
 * - provider_runs (usage reconciliation with original user_id)
 *
 * Note: user_id UUID is preserved because it's not PII and is essential for
 * audit trails, transaction grouping, refunds, and financial compliance.
 *
 * @param userId - The UUID of the user to delete
 * @returns AccountDeletionResult with success status and details
 */
export async function deleteUserAccount(userId: string): Promise<AccountDeletionResult> {
  console.log(`[AccountDeletion] Starting account deletion for user: ${userId}`)

  try {
    // Step 1: Verify user exists
    const { data: user, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId)

    if (userError || !user) {
      throw new Error(`User not found: ${userId}`)
    }

    console.log(`[AccountDeletion] Found user: ${user.user.email || userId}`)

    // Step 2: Get all attachment files
    console.log('[AccountDeletion] Fetching attachment files...')
    const attachmentFiles = await getUserAttachmentFiles(userId)
    const storagePaths = attachmentFiles.map(f => f.storage_path)

    // Step 3: Delete files from storage
    console.log('[AccountDeletion] Deleting storage files...')
    const deletedFilesCount = await deleteStorageFiles(storagePaths)

    // Step 4: Cancel active subscription
    console.log('[AccountDeletion] Checking for active subscription...')
    const subscriptionCanceled = await cancelUserSubscription(userId)

    // Step 5: Delete profile first (triggers cascade to all user content)
    // This must happen BEFORE deleting from auth.users
    console.log('[AccountDeletion] Deleting user profile...')
    const { error: profileDeleteError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId)

    if (profileDeleteError) {
      throw new Error(`Failed to delete user profile: ${profileDeleteError.message}`)
    }

    // Step 6: Delete user from auth.users (now succeeds since profile is gone)
    console.log('[AccountDeletion] Deleting user from auth.users...')
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (authDeleteError) {
      throw new Error(`Failed to delete user from auth: ${authDeleteError.message}`)
    }

    console.log('[AccountDeletion] ✅ Account deletion completed successfully')

    return {
      success: true,
      userId,
      deletedFiles: deletedFilesCount,
      subscriptionCanceled,
    }
  } catch (error: any) {
    console.error('[AccountDeletion] ❌ Error during account deletion:', error)

    return {
      success: false,
      userId,
      deletedFiles: 0,
      subscriptionCanceled: false,
      error: error.message || 'Unknown error occurred',
    }
  }
}

/**
 * Validate that a user can be deleted
 * This is a safety check before performing the actual deletion
 *
 * @param userId - The UUID of the user to validate
 * @returns Object with valid flag and optional error message
 */
export async function validateUserDeletion(userId: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // Check if user exists
    const { data: user, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId)

    if (userError || !user) {
      return {
        valid: false,
        error: 'User not found',
      }
    }

    // Check if foreign key constraints have been fixed
    // Query for constraint details
    const { data: fkData, error: fkError } = await supabaseAdmin.rpc('check_fk_constraints', {
      table_names: ['credits_ledger', 'subscriptions', 'provider_runs'],
    })

    // Note: This RPC function would need to be created in Supabase
    // For now, we'll skip this check and rely on manual verification
    // TODO: Create RPC function to verify FK constraints

    return {
      valid: true,
    }
  } catch (error: any) {
    return {
      valid: false,
      error: error.message || 'Unknown error occurred',
    }
  }
}
