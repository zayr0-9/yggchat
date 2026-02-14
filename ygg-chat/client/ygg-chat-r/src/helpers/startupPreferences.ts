export type StartupLandingPreference = 'homepage' | 'latest-chat'

const DEFAULT_STARTUP_LANDING: StartupLandingPreference = 'homepage'
const STORAGE_KEY = 'startup:landing-preference'

export const STARTUP_LANDING_CHANGE_EVENT = 'startup-landing-preference-change'

export const loadStartupLandingPreference = (): StartupLandingPreference => {
  if (typeof window === 'undefined') return DEFAULT_STARTUP_LANDING

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'latest-chat' ? 'latest-chat' : DEFAULT_STARTUP_LANDING
  } catch {
    return DEFAULT_STARTUP_LANDING
  }
}

export const saveStartupLandingPreference = (value: StartupLandingPreference): void => {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(STORAGE_KEY, value)
    window.dispatchEvent(new CustomEvent(STARTUP_LANDING_CHANGE_EVENT, { detail: value }))
  } catch {
    // Ignore localStorage errors (e.g. private mode)
  }
}
