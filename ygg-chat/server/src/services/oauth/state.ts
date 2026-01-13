import crypto from 'crypto'

export interface OAuthStatePayload {
  userId: string
  provider: string
  exp: number
  nonce: string
}

const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000

export function getOAuthStateSecret(): string {
  const secret = process.env.YGG_OAUTH_STATE_SECRET
  if (!secret) {
    throw new Error('Missing YGG_OAUTH_STATE_SECRET')
  }
  return secret
}

export function createSignedOAuthState(
  payload: { userId: string; provider: string },
  secret: string,
  ttlMs: number = DEFAULT_STATE_TTL_MS
): string {
  const statePayload: OAuthStatePayload = {
    userId: payload.userId,
    provider: payload.provider,
    exp: Date.now() + ttlMs,
    nonce: crypto.randomBytes(16).toString('hex'),
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(statePayload))
  const signature = base64UrlEncode(crypto.createHmac('sha256', secret).update(encodedPayload).digest())
  return `${encodedPayload}.${signature}`
}

export function verifySignedOAuthState(state: string, secret: string): OAuthStatePayload | null {
  if (!state) return null
  const [payloadB64, signatureB64] = state.split('.')
  if (!payloadB64 || !signatureB64) return null

  const expected = base64UrlEncode(crypto.createHmac('sha256', secret).update(payloadB64).digest())
  if (!safeCompare(expected, signatureB64)) {
    return null
  }

  try {
    const payloadJson = base64UrlDecode(payloadB64)
    const payload = JSON.parse(payloadJson) as OAuthStatePayload
    if (!payload?.userId || !payload?.provider || !payload?.exp) return null
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

function base64UrlEncode(input: string | Buffer): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
