export const CHAT_UI_TOKEN_USAGE_VISIBILITY_KEY = 'chat:showTokenUsageBar'
export const CHAT_UI_TOKEN_USAGE_VISIBILITY_CHANGE_EVENT = 'chatUi:tokenUsageVisibilityChange'

export const loadShowTokenUsageBar = (): boolean => {
  try {
    const stored = localStorage.getItem(CHAT_UI_TOKEN_USAGE_VISIBILITY_KEY)
    return stored !== null ? stored === 'true' : true
  } catch {
    return true
  }
}

export const saveShowTokenUsageBar = (show: boolean): void => {
  try {
    localStorage.setItem(CHAT_UI_TOKEN_USAGE_VISIBILITY_KEY, String(show))
    window.dispatchEvent(new CustomEvent<boolean>(CHAT_UI_TOKEN_USAGE_VISIBILITY_CHANGE_EVENT, { detail: show }))
  } catch {
    // no-op
  }
}
