import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { defaultVoiceSettings, VoiceSettings } from './voiceSettingsTypes'

const STORAGE_KEY = 'ygg_voice_settings'

// Load settings from localStorage
const loadSettings = (): VoiceSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Merge with defaults to handle new fields
      return { ...defaultVoiceSettings, ...parsed }
    }
  } catch (e) {
    console.error('[VoiceSettings] Failed to load from localStorage:', e)
  }
  return defaultVoiceSettings
}

// Save settings to localStorage
const saveSettings = (settings: VoiceSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('[VoiceSettings] Failed to save to localStorage:', e)
  }
}

const initialState: VoiceSettings = loadSettings()

export const voiceSettingsSlice = createSlice({
  name: 'voiceSettings',
  initialState,
  reducers: {
    // Wake word settings
    setWakeWordEnabled: (state, action: PayloadAction<boolean>) => {
      state.wakeWordEnabled = action.payload
      saveSettings(state)
    },
    setWakeWordThreshold: (state, action: PayloadAction<number>) => {
      state.wakeWordThreshold = Math.max(0.1, Math.min(1.0, action.payload))
      saveSettings(state)
    },
    setWakeWordCooldownMs: (state, action: PayloadAction<number>) => {
      state.wakeWordCooldownMs = Math.max(500, Math.min(10000, action.payload))
      saveSettings(state)
    },
    setWakeWordKeyword: (state, action: PayloadAction<string>) => {
      state.wakeWordKeyword = action.payload
      saveSettings(state)
    },

    // STT settings
    setSttSilenceThreshold: (state, action: PayloadAction<number>) => {
      state.sttSilenceThreshold = Math.max(0.5, Math.min(10, action.payload))
      saveSettings(state)
    },
    setSttLanguage: (state, action: PayloadAction<string>) => {
      state.sttLanguage = action.payload
      saveSettings(state)
    },
    setSttModel: (state, action: PayloadAction<'tiny' | 'base' | 'small'>) => {
      state.sttModel = action.payload
      saveSettings(state)
    },
    setSttAutoStart: (state, action: PayloadAction<boolean>) => {
      state.sttAutoStart = action.payload
      saveSettings(state)
    },

    // General
    setVoiceInputEnabled: (state, action: PayloadAction<boolean>) => {
      state.voiceInputEnabled = action.payload
      saveSettings(state)
    },

    // Bulk update
    updateVoiceSettings: (state, action: PayloadAction<Partial<VoiceSettings>>) => {
      Object.assign(state, action.payload)
      saveSettings(state)
    },

    // Reset to defaults
    resetVoiceSettings: state => {
      Object.assign(state, defaultVoiceSettings)
      saveSettings(state)
    },
  },
})

export const {
  setWakeWordEnabled,
  setWakeWordThreshold,
  setWakeWordCooldownMs,
  setWakeWordKeyword,
  setSttSilenceThreshold,
  setSttLanguage,
  setSttModel,
  setSttAutoStart,
  setVoiceInputEnabled,
  updateVoiceSettings,
  resetVoiceSettings,
} = voiceSettingsSlice.actions

export default voiceSettingsSlice.reducer
