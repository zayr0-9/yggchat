type RuntimeAuthSnapshot = {
  accessToken: string | null
  userId: string | null
}

export const LOCAL_AUTH_USER_ID = 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3'
const LOCAL_AUTH_TOKENS = new Set(['electron-local-token', 'local-mode-token'])

export const isElectronMode =
  (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__) || import.meta.env.VITE_ENVIRONMENT === 'electron'

const isLikelyJwt = (token: string | null | undefined): boolean => {
  if (!token || typeof token !== 'string') return false
  return token.split('.').length === 3
}

export const isCloudSession = (snapshot: Partial<RuntimeAuthSnapshot> | null | undefined): boolean => {
  const accessToken = snapshot?.accessToken || null
  const userId = snapshot?.userId || null

  if (!accessToken || !userId) return false
  if (LOCAL_AUTH_TOKENS.has(accessToken)) return false

  return isLikelyJwt(accessToken)
}

const readRuntimeSnapshotFromStorage = (): RuntimeAuthSnapshot => {
  try {
    if (typeof window !== 'undefined' && (window as any)._cachedElectronSession) {
      const session = (window as any)._cachedElectronSession
      return {
        accessToken: session?.accessToken || session?.session?.access_token || null,
        userId: session?.userId || session?.user?.id || session?.session?.user?.id || null,
      }
    }
  } catch {
    // ignore
  }

  try {
    const raw = localStorage.getItem('supabase-auth-token')
    if (!raw) {
      return { accessToken: null, userId: null }
    }
    const parsed = JSON.parse(raw)
    const session = parsed?.currentSession || parsed?.session || parsed
    return {
      accessToken: session?.access_token || null,
      userId: session?.user?.id || null,
    }
  } catch {
    return { accessToken: null, userId: null }
  }
}

let cloudSessionEnabled = isCloudSession(readRuntimeSnapshotFromStorage())

export let isCommunityMode = !cloudSessionEnabled
export let isElectronCommunityMode = isElectronMode && isCommunityMode
export let isCloudBackendAllowed = cloudSessionEnabled

const applyRuntimeAuthMode = (enabled: boolean) => {
  cloudSessionEnabled = enabled
  isCommunityMode = !enabled
  isElectronCommunityMode = isElectronMode && isCommunityMode
  isCloudBackendAllowed = enabled
}

export const syncRuntimeAuthMode = (snapshot?: Partial<RuntimeAuthSnapshot> | null) => {
  const resolved = snapshot
    ? {
        accessToken: snapshot.accessToken || null,
        userId: snapshot.userId || null,
      }
    : readRuntimeSnapshotFromStorage()

  applyRuntimeAuthMode(isCloudSession(resolved))
}

export const isCloudSessionEnabled = () => cloudSessionEnabled
