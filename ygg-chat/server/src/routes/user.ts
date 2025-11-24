// server/src/routes/user.ts
import express from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import { verifyAuth } from '../middleware/supaAuth'
import { deleteUserAccount, validateUserDeletion } from '../utils/accountDeletion'

const router = express.Router()

/**
 * DELETE /api/user/account
 * Delete user account and all associated data
 *
 * IMPORTANT: This is a destructive operation that:
 * - Deletes all user content (messages, conversations, projects, attachments)
 * - Cancels active subscriptions
 * - Preserves billing history (credits_ledger, subscriptions, provider_runs)
 *
 * Requires authentication via JWT token in Authorization header
 */
router.delete(
  '/account',
  asyncHandler(async (req, res) => {
    // Verify authentication and get user ID from JWT
    const { userId } = await verifyAuth(req)

    // Additional safety check: user must explicitly confirm deletion
    const { confirmDeletion } = req.body

    if (!confirmDeletion) {
      return res.status(400).json({
        error: 'Account deletion requires explicit confirmation',
        message: 'Please set confirmDeletion to true in the request body to proceed',
      })
    }

    console.log(`[UserRoutes] Account deletion requested by user: ${userId}`)

    // Validate that the user can be deleted
    const validation = await validateUserDeletion(userId)
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Cannot delete account',
        message: validation.error || 'User validation failed',
      })
    }

    // Perform account deletion
    const result = await deleteUserAccount(userId)

    if (!result.success) {
      return res.status(500).json({
        error: 'Account deletion failed',
        message: result.error || 'Unknown error occurred',
      })
    }

    console.log(`[UserRoutes] ✅ Account deletion successful for user: ${userId}`)

    res.json({
      success: true,
      message: 'Account deleted successfully',
      details: {
        deletedFiles: result.deletedFiles,
        subscriptionCanceled: result.subscriptionCanceled,
      },
    })
  })
)

/**
 * GET /api/user/deletion-info
 * Get information about what will be deleted when account is deleted
 *
 * This endpoint helps users understand the impact of account deletion
 * before they proceed with the actual deletion.
 *
 * Requires authentication via JWT token in Authorization header
 */
router.get(
  '/deletion-info',
  asyncHandler(async (req, res) => {
    // Verify authentication and get user ID from JWT
    const { userId, client } = await verifyAuth(req)

    // Query counts of data that will be deleted
    const [messagesCount, conversationsCount, projectsCount, attachmentsCount, profileData] = await Promise.all([
      client.from('messages').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      client.from('conversations').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      client.from('projects').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      client
        .from('message_attachments')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', userId)
        .eq('storage', 'file'),
      client.from('profiles').select('active_subscription_id, username').eq('id', userId).single(),
    ])

    const hasActiveSubscription = !!profileData.data?.active_subscription_id

    res.json({
      userId,
      username: profileData.data?.username || 'Unknown',
      hasActiveSubscription,
      willBeDeleted: {
        messages: messagesCount.count || 0,
        conversations: conversationsCount.count || 0,
        projects: projectsCount.count || 0,
        attachments: attachmentsCount.count || 0,
      },
      willBePreserved: [
        'Billing history (credit transactions)',
        'Subscription history',
        'Usage reconciliation records',
      ],
      warning:
        'This action is permanent and cannot be undone. All your conversations, messages, and files will be permanently deleted.',
    })
  })
)

export default router
