import { supabase } from '../supabase'

/**
 * Electron User Allowlist
 *
 * Provides authorization checks for Electron builds to restrict OAuth
 * to login-only (no signups). Web builds have no restrictions.
 */

export interface AllowlistEntry {
  user_id: string
  email: string
  created_at: string
}

/**
 * Check if a user is authorized to access the Electron application
 *
 * @param userId - The Supabase user ID to check
 * @returns true if user is in allowlist, false otherwise
 */
export async function isUserAllowlisted(userId: string): Promise<boolean> {
  if (!supabase) {
    console.warn('[Allowlist] Supabase client not available')
    return false
  }

  try {
    const { data, error } = await supabase
      .from('electron_allowlist')
      .select('user_id')
      .eq('user_id', userId)
      .single()

    if (error) {
      // User not found is expected for non-allowlisted users
      if (error.code === 'PGRST116') {
        console.log('[Allowlist] User not in allowlist:', userId)
        return false
      }
      throw error
    }

    console.log('[Allowlist] User authorized:', userId)
    return !!data
  } catch (error) {
    console.error('[Allowlist] Error checking allowlist:', error)
    return false
  }
}

/**
 * Check if a user email is authorized (useful before authentication completes)
 *
 * @param email - The email address to check
 * @returns true if email is in allowlist, false otherwise
 */
export async function isEmailAllowlisted(email: string): Promise<boolean> {
  if (!supabase) {
    console.warn('[Allowlist] Supabase client not available')
    return false
  }

  try {
    const { data, error } = await supabase
      .from('electron_allowlist')
      .select('email')
      .eq('email', email.toLowerCase())
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        console.log('[Allowlist] Email not in allowlist:', email)
        return false
      }
      throw error
    }

    console.log('[Allowlist] Email authorized:', email)
    return !!data
  } catch (error) {
    console.error('[Allowlist] Error checking email allowlist:', error)
    return false
  }
}
