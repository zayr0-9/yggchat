export interface GoogleDriveOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  authUrl: string
  tokenUrl: string
}

export interface GoogleDriveTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  id_token?: string
}

const DEFAULT_SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export function getGoogleDriveOAuthConfig(): GoogleDriveOAuthConfig {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_DRIVE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, or GOOGLE_DRIVE_REDIRECT_URI')
  }

  const scopes = parseScopes(process.env.GOOGLE_DRIVE_SCOPES, DEFAULT_SCOPES)

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    authUrl: GOOGLE_AUTH_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
  }
}

export function buildGoogleDriveAuthUrl(config: GoogleDriveOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })

  return `${config.authUrl}?${params.toString()}`
}

export async function exchangeGoogleDriveCode(
  config: GoogleDriveOAuthConfig,
  code: string
): Promise<GoogleDriveTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  })

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Google token exchange failed: ${response.status} ${errorText}`)
  }

  return (await response.json()) as GoogleDriveTokenResponse
}

function parseScopes(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback
  const parts = raw.split(/[\s,]+/).map(item => item.trim()).filter(Boolean)
  return parts.length > 0 ? parts : fallback
}
