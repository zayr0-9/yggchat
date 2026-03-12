import { isCloudSession, isElectronMode } from '../../config/runtimeMode'
import { localApi } from '../../utils/api'

interface HeadlessProviderTokenSnapshot {
  accessToken?: string | null
  userId?: string | null
}

function normalizeSnapshot(snapshot: HeadlessProviderTokenSnapshot) {
  const accessToken = typeof snapshot.accessToken === 'string' ? snapshot.accessToken.trim() : ''
  const userId = typeof snapshot.userId === 'string' ? snapshot.userId.trim() : ''

  return {
    accessToken: accessToken || null,
    userId: userId || null,
  }
}

export async function syncHeadlessOpenRouterToken(snapshot: HeadlessProviderTokenSnapshot): Promise<void> {
  if (!isElectronMode) return

  const normalized = normalizeSnapshot(snapshot)
  if (!isCloudSession(normalized)) return

  await localApi.post('/provider-auth/openrouter/token', {
    userId: normalized.userId,
    accessToken: normalized.accessToken,
  })
}

export async function clearHeadlessOpenRouterToken(userId: string | null | undefined): Promise<void> {
  if (!isElectronMode) return

  const normalizedUserId = typeof userId === 'string' ? userId.trim() : ''
  if (!normalizedUserId) return

  await localApi.delete(`/provider-auth/openrouter/token?userId=${encodeURIComponent(normalizedUserId)}`)
}
