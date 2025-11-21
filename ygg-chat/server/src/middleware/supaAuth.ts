/**
 * Shared Supabase Authentication Utilities
 *
 * This module provides reusable authentication functions for Supabase-based routes.
 * - Extracts and validates JWT tokens from Authorization headers
 * - Decodes JWT claims locally (zero network calls)
 * - Creates authenticated Supabase clients with RLS enforcement
 */

import type { Request } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAuthenticatedClient } from '../database/supamodels'

// Helper to throw errors with status codes
function throwAuthError(message: string, status: number = 401): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

/**
 * Extract JWT token from Authorization header
 *
 * @param req - Express request object
 * @returns JWT token string
 * @throws Error if Authorization header is missing or invalid
 */
export function getAuthToken(req: Request): string {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    throwAuthError('Missing or invalid Authorization header. Expected format: Bearer <jwt>', 401)
  }

  return authHeader!.substring(7) // Remove 'Bearer ' prefix
}

/**
 * Decode JWT locally without network calls (server-side version)
 * Only decodes the payload - does NOT verify signature (assumes Supabase already validated)
 *
 * @param token - The JWT access token
 * @returns The decoded JWT payload or null if invalid
 */
export function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    // JWT format: header.payload.signature
    const parts = token.split('.')
    if (parts.length !== 3) {
      console.error('[supaAuth] ❌ Invalid JWT format')
      return null
    }

    // Decode the payload (second part)
    const payload = parts[1]

    // Base64URL decode (handle URL-safe base64)
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8')

    return JSON.parse(jsonPayload)
  } catch (err) {
    console.error('[supaAuth] ❌ Failed to decode JWT:', err)
    return null
  }
}

/**
 * Verify JWT token and return authenticated Supabase client + user ID
 *
 * The client is authenticated with the user's JWT, so:
 * - RLS policies automatically filter by owner_id
 * - auth.uid() returns the user's actual UUID (not NULL)
 *
 * ZERO network calls - decodes JWT locally for instant validation
 *
 * @param req - Express request object
 * @returns Object with userId and authenticated Supabase client
 * @throws Error if authentication fails
 */
export async function verifyAuth(req: Request): Promise<{ userId: string; client: SupabaseClient }> {
  const jwt = getAuthToken(req)

  // Create authenticated client with user's JWT
  const client = createAuthenticatedClient(jwt)

  // Decode JWT LOCALLY (NO network call - pure base64 decode)
  const claims = decodeJWT(jwt)

  if (!claims) {
    throwAuthError('Authentication failed: Invalid JWT format', 401)
  }

  // Check expiry locally
  const exp = claims.exp as number
  if (!exp) {
    throwAuthError('Authentication failed: Missing exp claim in JWT', 401)
  }

  const now = Math.floor(Date.now() / 1000)
  if (exp < now) {
    throwAuthError('Authentication failed: JWT has expired', 401)
  }

  // Extract user ID from JWT claims (sub = subject = user ID)
  const userId = claims.sub as string

  if (!userId) {
    throwAuthError('Authentication failed: Missing user ID in token claims', 401)
  }

  // console.log('[supaAuth] ✅ JWT decoded locally (ZERO network calls) for user:', userId)

  return { userId, client }
}
