export interface VoiceSettings {
  // Wake word settings
  wakeWordEnabled: boolean
  wakeWordThreshold: number // 0.0 - 1.0, detection sensitivity
  wakeWordCooldownMs: number // milliseconds between detections
  wakeWordKeyword: string // e.g., 'hey_jarvis', 'alexa', 'hey_mycroft'

  // Speech-to-text settings
  sttSilenceThreshold: number // seconds of silence before auto-stop
  sttLanguage: string // e.g., 'en', 'es', 'fr'
  sttModel: 'tiny' | 'base' | 'small' // Whisper model size
  sttAutoStart: boolean // Start STT automatically after wake word

  // General voice settings
  voiceInputEnabled: boolean // Master toggle for voice input features
}

export const defaultVoiceSettings: VoiceSettings = {
  wakeWordEnabled: false,
  wakeWordThreshold: 0.5,
  wakeWordCooldownMs: 2000,
  wakeWordKeyword: 'hey_jarvis',

  sttSilenceThreshold: 2,
  sttLanguage: 'en',
  sttModel: 'tiny',
  sttAutoStart: true,

  voiceInputEnabled: true,
}

export const WAKE_WORD_OPTIONS = [
  { value: 'hey_jarvis', label: 'Hey Jarvis' },
  { value: 'alexa', label: 'Alexa' },
  { value: 'hey_mycroft', label: 'Hey Mycroft' },
  { value: 'hey_rhasspy', label: 'Hey Rhasspy' },
] as const

export const STT_MODEL_OPTIONS = [
  { value: 'tiny', label: 'Tiny (~40MB, fastest)', description: 'Best for quick responses' },
  { value: 'base', label: 'Base (~75MB, balanced)', description: 'Good balance of speed and accuracy' },
  { value: 'small', label: 'Small (~150MB, accurate)', description: 'Best accuracy, slower' },
] as const

export const STT_LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
] as const
