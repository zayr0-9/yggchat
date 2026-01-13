import { supabaseAdmin } from './supamodels'

export interface ProviderCredentialRecord {
  id: string
  user_id: string
  provider: string
  external_account_id?: string | null
  refresh_token: string
  client_id?: string | null
  client_secret?: string | null
  token_url?: string | null
  scopes?: string[] | null
  created_at: string
  updated_at: string
  last_used_at?: string | null
}

export interface UpsertProviderCredentialInput {
  userId: string
  provider: string
  refreshToken: string
  clientId?: string | null
  clientSecret?: string | null
  tokenUrl?: string | null
  scopes?: string[] | null
  externalAccountId?: string | null
}

export async function getProviderCredential(
  userId: string,
  provider: string
): Promise<ProviderCredentialRecord | null> {
  const { data, error } = await supabaseAdmin
    .from('provider_credentials')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data ?? null
}

export async function upsertProviderCredential(
  input: UpsertProviderCredentialInput
): Promise<ProviderCredentialRecord> {
  const payload = {
    user_id: input.userId,
    provider: input.provider,
    external_account_id: input.externalAccountId ?? null,
    refresh_token: input.refreshToken,
    client_id: input.clientId ?? null,
    client_secret: input.clientSecret ?? null,
    token_url: input.tokenUrl ?? null,
    scopes: input.scopes ?? null,
  }

  const { data, error } = await supabaseAdmin
    .from('provider_credentials')
    .upsert(payload, { onConflict: 'user_id,provider' })
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function deleteProviderCredential(userId: string, provider: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('provider_credentials')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)

  if (error) {
    throw error
  }
}

export async function touchProviderCredential(userId: string, provider: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('provider_credentials')
    .update({ last_used_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', provider)

  if (error) {
    throw error
  }
}
