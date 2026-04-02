// uiSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { ConversationId, MessageId, ProjectId } from '../../../../../shared/types'

export type UiNotification = {
  id: string
  kind: 'branch_stream_completed'
  title: string
  description?: string
  conversationId: ConversationId
  projectId: ProjectId | null
  messageId: MessageId
  createdAt: string
}

export interface UiState {
  rightBarCollapsed: boolean
  rightBarWidth: number
  notifications: UiNotification[]
}

const MAX_NOTIFICATIONS = 6
const RIGHT_BAR_COLLAPSED_STORAGE_KEY = 'rightbar:collapsed'
const RIGHT_BAR_WIDTH_STORAGE_KEY = 'rightbar:width'
const RIGHT_BAR_DEFAULT_WIDTH_PX = 360
const RIGHT_BAR_MIN_WIDTH_PX = 280
const RIGHT_BAR_MAX_WIDTH_PX = 720

const clampRightBarWidth = (value: number): number => {
  if (!Number.isFinite(value)) return RIGHT_BAR_DEFAULT_WIDTH_PX
  return Math.min(RIGHT_BAR_MAX_WIDTH_PX, Math.max(RIGHT_BAR_MIN_WIDTH_PX, Math.round(value)))
}

const persistRightBarCollapsed = (collapsed: boolean) => {
  try {
    localStorage.setItem(RIGHT_BAR_COLLAPSED_STORAGE_KEY, String(collapsed))
  } catch {}
}

const persistRightBarWidth = (width: number) => {
  try {
    localStorage.setItem(RIGHT_BAR_WIDTH_STORAGE_KEY, String(clampRightBarWidth(width)))
  } catch {}
}

// Load initial state from localStorage
const getInitialCollapsed = (): boolean => {
  try {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem(RIGHT_BAR_COLLAPSED_STORAGE_KEY)
    if (stored !== null) {
      return stored === 'true'
    }
    return true // Default collapsed
  } catch {
    return true
  }
}

const getInitialRightBarWidth = (): number => {
  try {
    if (typeof window === 'undefined') return RIGHT_BAR_DEFAULT_WIDTH_PX
    const stored = localStorage.getItem(RIGHT_BAR_WIDTH_STORAGE_KEY)
    const parsed = stored ? Number.parseFloat(stored) : Number.NaN
    return clampRightBarWidth(parsed)
  } catch {
    return RIGHT_BAR_DEFAULT_WIDTH_PX
  }
}

const initialState: UiState = {
  rightBarCollapsed: getInitialCollapsed(),
  rightBarWidth: getInitialRightBarWidth(),
  notifications: [],
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    rightBarCollapsedSet: (state, action: PayloadAction<boolean>) => {
      state.rightBarCollapsed = action.payload
      persistRightBarCollapsed(action.payload)
    },
    rightBarWidthSet: (state, action: PayloadAction<number>) => {
      const nextWidth = clampRightBarWidth(action.payload)
      state.rightBarWidth = nextWidth
      persistRightBarWidth(nextWidth)
    },
    rightBarToggled: state => {
      state.rightBarCollapsed = !state.rightBarCollapsed
      persistRightBarCollapsed(state.rightBarCollapsed)
    },
    rightBarExpanded: state => {
      state.rightBarCollapsed = false
      persistRightBarCollapsed(false)
    },
    notificationAdded: (state, action: PayloadAction<UiNotification>) => {
      const notification = action.payload
      const existingIndex = state.notifications.findIndex(item => item.id === notification.id)
      if (existingIndex >= 0) {
        state.notifications[existingIndex] = notification
      } else {
        state.notifications.unshift(notification)
      }

      if (state.notifications.length > MAX_NOTIFICATIONS) {
        state.notifications = state.notifications.slice(0, MAX_NOTIFICATIONS)
      }
    },
    notificationDismissed: (state, action: PayloadAction<string>) => {
      state.notifications = state.notifications.filter(item => item.id !== action.payload)
    },
    notificationsCleared: state => {
      state.notifications = []
    },
  },
})

export const uiActions = uiSlice.actions

export default uiSlice.reducer
