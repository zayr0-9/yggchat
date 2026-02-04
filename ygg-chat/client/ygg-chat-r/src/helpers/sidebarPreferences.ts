export type ConversationTab = 'recent' | 'favorites'

const DEFAULT_TAB: ConversationTab = 'recent'
const STORAGE_KEY = 'sidebar:default-conversation-tab'

export const SIDEBAR_DEFAULT_TAB_CHANGE_EVENT = 'sidebar-default-conversation-tab-change'

export const loadDefaultConversationTab = (): ConversationTab => {
  if (typeof window === 'undefined') return DEFAULT_TAB
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'favorites' ? 'favorites' : DEFAULT_TAB
  } catch {
    return DEFAULT_TAB
  }
}

export const saveDefaultConversationTab = (tab: ConversationTab): void => {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, tab)
    window.dispatchEvent(new CustomEvent(SIDEBAR_DEFAULT_TAB_CHANGE_EVENT, { detail: tab }))
  } catch {
    // Ignore localStorage errors (e.g., private mode)
  }
}
