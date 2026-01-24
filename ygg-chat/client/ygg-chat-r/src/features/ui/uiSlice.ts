// uiSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface UiState {
  rightBarCollapsed: boolean
}

// Load initial state from localStorage
const getInitialCollapsed = (): boolean => {
  try {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem('rightbar:collapsed')
    if (stored !== null) {
      return stored === 'true'
    }
    return true // Default collapsed
  } catch {
    return true
  }
}

const initialState: UiState = {
  rightBarCollapsed: getInitialCollapsed(),
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    rightBarCollapsedSet: (state, action: PayloadAction<boolean>) => {
      state.rightBarCollapsed = action.payload
      // Persist to localStorage
      try {
        localStorage.setItem('rightbar:collapsed', String(action.payload))
      } catch { }
    },
    rightBarToggled: state => {
      state.rightBarCollapsed = !state.rightBarCollapsed
      // Persist to localStorage
      try {
        localStorage.setItem('rightbar:collapsed', String(state.rightBarCollapsed))
      } catch { }
    },
    rightBarExpanded: state => {
      state.rightBarCollapsed = false
      // Persist to localStorage
      try {
        localStorage.setItem('rightbar:collapsed', 'false')
      } catch { }
    },
  },
})

export const uiActions = uiSlice.actions

export default uiSlice.reducer
