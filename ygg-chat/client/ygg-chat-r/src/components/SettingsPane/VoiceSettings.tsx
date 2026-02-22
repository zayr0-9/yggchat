import React from 'react'
import {
  selectVoiceInputEnabled,
  selectVoiceSettings,
  setSttAutoStart,
  setSttLanguage,
  setSttModel,
  setSttSilenceThreshold,
  setVoiceInputEnabled,
  setWakeWordCooldownMs,
  setWakeWordEnabled,
  setWakeWordKeyword,
  setWakeWordThreshold,
  STT_LANGUAGE_OPTIONS,
  STT_MODEL_OPTIONS,
  WAKE_WORD_OPTIONS,
} from '../../features/voiceSettings'
import { useAppDispatch, useAppSelector } from '../../hooks/redux'

export const VoiceSettings: React.FC = () => {
  const dispatch = useAppDispatch()
  const settings = useAppSelector(selectVoiceSettings)
  const voiceInputEnabled = useAppSelector(selectVoiceInputEnabled)

  const disabled = !voiceInputEnabled
  const wakeWordTemporarilyDisabled = true
  const wakeWordDisabled = disabled || wakeWordTemporarilyDisabled

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <span className='text-sm font-medium text-stone-700 dark:text-stone-200'>Voice Input Settings</span>
          <p className='text-xs text-neutral-500 dark:text-neutral-400'>Enable hands-free chat controls</p>
        </div>
        <label className='relative inline-flex items-center cursor-pointer'>
          <input
            type='checkbox'
            checked={voiceInputEnabled}
            onChange={e => dispatch(setVoiceInputEnabled(e.target.checked))}
            className='sr-only peer'
          />
          <div className="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer dark:bg-neutral-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-neutral-600 peer-checked:bg-sky-500"></div>
        </label>
      </div>

      {/* Wake Word Section */}
      <div className={`space-y-4 p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 ${disabled ? 'opacity-60' : ''}`}>
        <div className='flex items-center justify-between'>
          <div>
            <h4 className='text-sm font-medium text-stone-700 dark:text-stone-200'>Wake Word Detection</h4>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              Hands-free activation - say the wake word to start voice input
            </p>
            {wakeWordTemporarilyDisabled && (
              <p className='text-xs text-amber-600 dark:text-amber-400'>Temporarily disabled</p>
            )}
          </div>
          <label className='relative inline-flex items-center cursor-pointer'>
            <input
              type='checkbox'
              checked={settings.wakeWordEnabled}
              onChange={e => dispatch(setWakeWordEnabled(e.target.checked))}
              disabled={wakeWordDisabled}
              className='sr-only peer'
            />
            <div className="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer dark:bg-neutral-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-neutral-600 peer-checked:bg-sky-500"></div>
          </label>
        </div>

        {settings.wakeWordEnabled && (
          <div className='space-y-4 pt-2'>
            {/* Wake Word Selection */}
            <div className='space-y-1'>
              <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Wake Word</label>
              <select
                value={settings.wakeWordKeyword}
                onChange={e => dispatch(setWakeWordKeyword(e.target.value))}
                disabled={wakeWordDisabled}
                className='w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-sky-500'
              >
                {WAKE_WORD_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Detection Sensitivity */}
            <div className='space-y-1'>
              <div className='flex items-center justify-between'>
                <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>
                  Detection Sensitivity
                </label>
                <span className='text-xs text-neutral-500'>{Math.round(settings.wakeWordThreshold * 100)}%</span>
              </div>
              <input
                type='range'
                min='10'
                max='90'
                value={settings.wakeWordThreshold * 100}
                onChange={e => dispatch(setWakeWordThreshold(Number(e.target.value) / 100))}
                disabled={wakeWordDisabled}
                className='w-full h-2 bg-neutral-200 dark:bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-sky-500'
              />
              <div className='flex justify-between text-xs text-neutral-400'>
                <span>More sensitive</span>
                <span>Less false positives</span>
              </div>
            </div>

            {/* Cooldown */}
            <div className='space-y-1'>
              <div className='flex items-center justify-between'>
                <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Cooldown Period</label>
                <span className='text-xs text-neutral-500'>{(settings.wakeWordCooldownMs / 1000).toFixed(1)}s</span>
              </div>
              <input
                type='range'
                min='500'
                max='5000'
                step='500'
                value={settings.wakeWordCooldownMs}
                onChange={e => dispatch(setWakeWordCooldownMs(Number(e.target.value)))}
                disabled={wakeWordDisabled}
                className='w-full h-2 bg-neutral-200 dark:bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-sky-500'
              />
              <p className='text-xs text-neutral-400'>Time to wait between detections</p>
            </div>
          </div>
        )}
      </div>

      {/* Speech-to-Text Section */}
      <div className={`space-y-4 p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800/50 ${disabled ? 'opacity-60' : ''}`}>
        <div>
          <h4 className='text-sm font-medium text-stone-700 dark:text-stone-200'>Speech-to-Text (Whisper)</h4>
          <p className='text-xs text-neutral-500 dark:text-neutral-400'>
            Offline speech recognition using local Whisper model
          </p>
        </div>

        {/* Auto-start after wake word */}
        <div className='flex items-center justify-between'>
          <div>
            <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>
              Auto-start after wake word
            </label>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              Begin recording immediately when wake word triggers
            </p>
          </div>
          <label className='relative inline-flex items-center cursor-pointer'>
            <input
              type='checkbox'
              checked={settings.sttAutoStart}
              onChange={e => dispatch(setSttAutoStart(e.target.checked))}
              disabled={disabled}
              className='sr-only peer'
            />
            <div className="w-11 h-6 bg-neutral-300 peer-focus:outline-none rounded-full peer dark:bg-neutral-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-neutral-600 peer-checked:bg-sky-500"></div>
          </label>
        </div>

        {/* Silence Threshold */}
        <div className='space-y-1'>
          <div className='flex items-center justify-between'>
            <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Silence Detection</label>
            <span className='text-xs text-neutral-500'>{settings.sttSilenceThreshold.toFixed(1)}s</span>
          </div>
          <input
            type='range'
            min='0.5'
            max='5'
            step='0.5'
            value={settings.sttSilenceThreshold}
            onChange={e => dispatch(setSttSilenceThreshold(Number(e.target.value)))}
            disabled={disabled}
            className='w-full h-2 bg-neutral-200 dark:bg-neutral-600 rounded-lg appearance-none cursor-pointer accent-sky-500'
          />
          <p className='text-xs text-neutral-400'>Seconds of silence before auto-stopping recording</p>
        </div>

        {/* Language Selection */}
        <div className='space-y-1'>
          <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Language</label>
          <select
            value={settings.sttLanguage}
            onChange={e => dispatch(setSttLanguage(e.target.value))}
            disabled={disabled}
            className='w-full px-3 py-2 text-sm rounded-lg border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-sky-500'
          >
            {STT_LANGUAGE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Model Selection */}
        <div className='space-y-2'>
          <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Model Size</label>
          <div className='space-y-2'>
            {STT_MODEL_OPTIONS.map(option => (
              <label
                key={option.value}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  settings.sttModel === option.value
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'
                    : 'border-neutral-200 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                }`}
              >
                <input
                  type='radio'
                  name='sttModel'
                  value={option.value}
                  checked={settings.sttModel === option.value}
                  onChange={() => dispatch(setSttModel(option.value))}
                  disabled={disabled}
                  className='w-4 h-4 text-sky-500 bg-neutral-100 border-neutral-300 focus:ring-sky-500'
                />
                <div>
                  <div className='text-sm font-medium text-neutral-700 dark:text-neutral-200'>{option.label}</div>
                  <div className='text-xs text-neutral-500 dark:text-neutral-400'>{option.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Info Note */}
      <div className='flex items-start gap-2 p-3 rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800'>
        <i className='bx bx-info-circle text-sky-500 text-lg mt-0.5'></i>
        <p className='text-xs text-sky-700 dark:text-sky-300'>
          Voice models run locally in your browser. First use will download the model files (~40-150MB depending on
          size). Wake word detection uses OpenWakeWord and speech recognition uses Whisper.
        </p>
      </div>
    </div>
  )
}
