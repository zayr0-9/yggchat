import type { Express } from 'express'
import { JWT_CLAIM_PATH } from '../../../src/features/chats/openaiOAuth.js'
import type { ProviderTokenStore } from '../providers/tokenStore.js'

interface RegisterProviderAuthRoutesDeps {
  tokenStore: ProviderTokenStore
}

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payload = parts[1]
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function extractAccountId(accessToken: string): string | null {
  const decoded = decodeJwtPayload(accessToken)
  if (!decoded) return null
  const authClaim = decoded[JWT_CLAIM_PATH]
  return authClaim?.chatgpt_account_id || null
}

export function registerProviderAuthRoutes(app: Express, deps: RegisterProviderAuthRoutesDeps): void {
  const { tokenStore } = deps

  const normalizePayload = (body: any) => {
    const {
      userId,
      user_id,
      accessToken,
      access_token,
      refreshToken,
      refresh_token,
      expiresAt,
      expires_at,
      accountId,
      account_id,
    } = body ?? {}

    const effectiveUserId = userId ?? user_id
    const effectiveAccessToken = accessToken ?? access_token
    const rawExpiresAt = expiresAt ?? expires_at ?? null
    const normalizedExpiresAt =
      typeof rawExpiresAt === 'number'
        ? new Date(rawExpiresAt).toISOString()
        : typeof rawExpiresAt === 'string' && rawExpiresAt.trim()
          ? Number.isFinite(Number(rawExpiresAt))
            ? new Date(Number(rawExpiresAt)).toISOString()
            : rawExpiresAt
          : null

    return {
      userId: effectiveUserId,
      accessToken: effectiveAccessToken,
      refreshToken: (refreshToken ?? refresh_token ?? null) as string | null,
      expiresAt: normalizedExpiresAt,
      accountId: accountId ?? account_id ?? null,
    }
  }

  const registerTokenRoutes = (providerSlug: 'openai' | 'openrouter', providerKey: string, opts?: { deriveAccountId?: boolean }) => {
    app.post(`/api/provider-auth/${providerSlug}/token`, (req, res) => {
      const payload = normalizePayload(req.body)

      if (!payload.userId || !payload.accessToken) {
        res.status(400).json({
          success: false,
          error: 'userId (or user_id) and accessToken (or access_token) are required',
        })
        return
      }

      const accountId = opts?.deriveAccountId ? payload.accountId ?? extractAccountId(String(payload.accessToken)) : payload.accountId
      if (opts?.deriveAccountId && !accountId) {
        res.status(400).json({
          success: false,
          error: 'accountId is required (or must be derivable from access token JWT claim).',
        })
        return
      }

      tokenStore.upsert({
        provider: providerKey,
        userId: String(payload.userId),
        accessToken: String(payload.accessToken),
        refreshToken: payload.refreshToken,
        expiresAt: payload.expiresAt,
        accountId: accountId ? String(accountId) : null,
      })

      res.json({ success: true })
    })

    app.get(`/api/provider-auth/${providerSlug}/token`, (req, res) => {
      const userId = String(req.query.userId ?? req.query.user_id ?? '')
      if (!userId) {
        res.status(400).json({ success: false, error: 'userId query param is required' })
        return
      }

      const tokenRecord = tokenStore.get(providerKey, userId)
      res.json({ success: true, hasToken: Boolean(tokenRecord), token: tokenRecord ?? null })
    })

    app.delete(`/api/provider-auth/${providerSlug}/token`, (req, res) => {
      const userId = String(req.query.userId ?? req.query.user_id ?? '')
      if (!userId) {
        res.status(400).json({ success: false, error: 'userId query param is required' })
        return
      }

      tokenStore.delete(providerKey, userId)
      res.json({ success: true })
    })
  }

  registerTokenRoutes('openai', 'openaichatgpt', { deriveAccountId: true })
  registerTokenRoutes('openrouter', 'openrouter')

  app.get('/api/provider-auth/models', (_req, res) => {
    res.json({
      success: true,
      providers: [
        {
          name: 'openaichatgpt',
          models: [
            'gpt-5.4',
            'gpt-5.3-codex',
            'gpt-5.2-codex',
            'gpt-5.1-codex-max',
            'gpt-5.1-codex-mini',
            'gpt-5.1-codex',
            'gpt-5.2',
            'gpt-5.1',
            'gpt-4o',
          ],
        },
        {
          name: 'openrouter',
          models: [
            'openai/gpt-4o-mini',
            'openai/gpt-4.1-mini',
            'anthropic/claude-3.7-sonnet',
            'google/gemini-2.5-flash',
          ],
        },
        {
          name: 'lmstudio',
          models: [
            'local-model',
          ],
        },
      ],
    })
  })
}
