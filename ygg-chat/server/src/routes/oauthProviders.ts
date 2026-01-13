import express from 'express'
import { deleteProviderCredential, getProviderCredential, upsertProviderCredential } from '../database/credential_table'
import { authEndpointsRateLimiter, authenticatedRateLimiter } from '../middleware/rateLimiter'
import { verifyAuth } from '../middleware/supaAuth'
import { asyncHandler } from '../utils/asyncHandler'
import {
  buildGoogleDriveAuthUrl,
  exchangeGoogleDriveCode,
  getGoogleDriveOAuthConfig,
} from '../services/oauth/googleDrive'
import { createSignedOAuthState, getOAuthStateSecret, verifySignedOAuthState } from '../services/oauth/state'

const router = express.Router()

// Check if Google Drive is connected for the current user
router.get(
  '/oauth/google-drive/status',
  authenticatedRateLimiter,
  asyncHandler(async (req, res) => {
    const { userId } = await verifyAuth(req)
    const credential = await getProviderCredential(userId, 'google_drive')

    res.json({
      connected: !!credential,
      connectedAt: credential?.created_at ?? null,
      lastUsedAt: credential?.last_used_at ?? null,
    })
  })
)

// Disconnect Google Drive for the current user
router.delete(
  '/oauth/google-drive/disconnect',
  authenticatedRateLimiter,
  asyncHandler(async (req, res) => {
    const { userId } = await verifyAuth(req)
    await deleteProviderCredential(userId, 'google_drive')
    res.json({ success: true })
  })
)

router.post(
  '/oauth/google-drive/start',
  authenticatedRateLimiter,
  asyncHandler(async (req, res) => {
    const { userId } = await verifyAuth(req)
    const config = getGoogleDriveOAuthConfig()
    const secret = getOAuthStateSecret()
    const state = createSignedOAuthState({ userId, provider: 'google_drive' }, secret)
    const authUrl = buildGoogleDriveAuthUrl(config, state)

    res.json({ authUrl })
  })
)

router.get(
  '/oauth/google-drive/callback',
  authEndpointsRateLimiter,
  asyncHandler(async (req, res) => {
    const { code, state, error, error_description } = req.query as {
      code?: string
      state?: string
      error?: string
      error_description?: string
    }

    if (error) {
      res.status(400).send(renderCallbackPage('Google authorization failed.', error_description || error))
      return
    }

    if (!code || !state) {
      res.status(400).send(renderCallbackPage('Missing OAuth code or state.', 'Invalid callback parameters.'))
      return
    }

    const secret = getOAuthStateSecret()
    const payload = verifySignedOAuthState(state, secret)
    if (!payload || payload.provider !== 'google_drive') {
      res.status(400).send(renderCallbackPage('Invalid OAuth state.', 'Please retry the connection flow.'))
      return
    }

    const config = getGoogleDriveOAuthConfig()
    const tokens = await exchangeGoogleDriveCode(config, code)

    if (!tokens.refresh_token) {
      res
        .status(400)
        .send(renderCallbackPage('Missing refresh token.', 'Ensure prompt=consent and access_type=offline.'))
      return
    }

    const scopes = tokens.scope ? tokens.scope.split(' ') : config.scopes

    await upsertProviderCredential({
      userId: payload.userId,
      provider: 'google_drive',
      refreshToken: tokens.refresh_token,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      tokenUrl: config.tokenUrl,
      scopes,
    })

    res.send(renderCallbackPage('Google Drive connected.', 'You can close this window.'))
  })
)

function renderCallbackPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 32px; max-width: 420px; text-align: center; }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { margin: 0; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}

export default router
