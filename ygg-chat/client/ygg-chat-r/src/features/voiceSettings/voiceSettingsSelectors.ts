import { createSelector } from '@reduxjs/toolkit'
import { RootState } from '../../store/store'

export const selectVoiceSettings = (state: RootState) => state.voiceSettings

export const selectWakeWordEnabled = (state: RootState) => state.voiceSettings.wakeWordEnabled
export const selectWakeWordThreshold = (state: RootState) => state.voiceSettings.wakeWordThreshold
export const selectWakeWordCooldownMs = (state: RootState) => state.voiceSettings.wakeWordCooldownMs
export const selectWakeWordKeyword = (state: RootState) => state.voiceSettings.wakeWordKeyword

export const selectSttSilenceThreshold = (state: RootState) => state.voiceSettings.sttSilenceThreshold
export const selectSttLanguage = (state: RootState) => state.voiceSettings.sttLanguage
export const selectSttModel = (state: RootState) => state.voiceSettings.sttModel
export const selectSttAutoStart = (state: RootState) => state.voiceSettings.sttAutoStart

export const selectVoiceInputEnabled = (state: RootState) => state.voiceSettings.voiceInputEnabled

// Derived selectors
export const selectWakeWordConfig = createSelector([selectVoiceSettings], settings => ({
  keywords: [settings.wakeWordKeyword],
  threshold: settings.wakeWordThreshold,
  cooldownMs: settings.wakeWordCooldownMs,
  autoStart: settings.wakeWordEnabled,
}))

export const selectSttConfig = createSelector([selectVoiceSettings], settings => ({
  language: settings.sttLanguage,
  model: settings.sttModel,
  silenceThreshold: settings.sttSilenceThreshold,
}))
