import React, { useCallback, useMemo, useRef, useState } from 'react'
import './ChatInputBorderAnimations.css'

export type ChatInputBorderAnimationType = 'none' | 'digital-breath' | 'data-wave' | 'orbit-rings' | 'shard-sweep'

export const CHAT_INPUT_BORDER_ANIMATION_STORAGE_KEY = 'chat:inputBorderAnimation'
export const CHAT_INPUT_BORDER_LIGHT_COLOR_STORAGE_KEY = 'chat:inputBorderLightColor'
export const CHAT_INPUT_BORDER_DARK_COLOR_STORAGE_KEY = 'chat:inputBorderDarkColor'

const CHAT_INPUT_BORDER_ANIMATIONS: {
  id: ChatInputBorderAnimationType
  name: string
  description: string
}[] = [
  {
    id: 'none',
    name: 'None',
    description: 'Use a static border with no animation.',
  },
  {
    id: 'digital-breath',
    name: 'Digital Breath',
    description: 'Softly expands and contracts with a subtle glow.',
  },
  {
    id: 'data-wave',
    name: 'Data Wave',
    description: 'A flowing wave sweeps around the full border ring.',
  },
  // {
  //   id: 'orbit-rings',
  //   name: 'Orbit Rings',
  //   description: 'Conic rings rotate with a sci-fi orbit look.',
  // },
  {
    id: 'shard-sweep',
    name: 'Shard Sweep',
    description: 'Angular streaks sweep the edge in layered passes.',
  },
]

const TAILWIND_COLORS = [
  { name: 'Emerald', value: '#10b981' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Red', value: '#ef4444' },
  { name: 'White', value: '#ffffff' },
]

export const getStoredChatInputBorderAnimation = (): ChatInputBorderAnimationType => {
  try {
    const stored = localStorage.getItem(CHAT_INPUT_BORDER_ANIMATION_STORAGE_KEY)
    if (stored && CHAT_INPUT_BORDER_ANIMATIONS.some(animation => animation.id === stored)) {
      return stored as ChatInputBorderAnimationType
    }
  } catch {
    // Ignore localStorage errors
  }
  return 'digital-breath'
}

export const getStoredChatInputBorderLightColor = (): string => {
  try {
    const stored = localStorage.getItem(CHAT_INPUT_BORDER_LIGHT_COLOR_STORAGE_KEY)
    if (stored) return stored
  } catch {
    // Ignore localStorage errors
  }
  return '#10b981'
}

export const getStoredChatInputBorderDarkColor = (): string => {
  try {
    const stored = localStorage.getItem(CHAT_INPUT_BORDER_DARK_COLOR_STORAGE_KEY)
    if (stored) return stored
  } catch {
    // Ignore localStorage errors
  }
  return '#34d399'
}

export const saveChatInputBorderAnimation = (animation: ChatInputBorderAnimationType): void => {
  try {
    localStorage.setItem(CHAT_INPUT_BORDER_ANIMATION_STORAGE_KEY, animation)
    window.dispatchEvent(new CustomEvent('inputBorderAnimationChange', { detail: animation }))
  } catch {
    // Ignore localStorage errors
  }
}

export const saveChatInputBorderLightColor = (color: string): void => {
  try {
    localStorage.setItem(CHAT_INPUT_BORDER_LIGHT_COLOR_STORAGE_KEY, color)
    window.dispatchEvent(new CustomEvent('inputBorderLightColorChange', { detail: color }))
  } catch {
    // Ignore localStorage errors
  }
}

export const saveChatInputBorderDarkColor = (color: string): void => {
  try {
    localStorage.setItem(CHAT_INPUT_BORDER_DARK_COLOR_STORAGE_KEY, color)
    window.dispatchEvent(new CustomEvent('inputBorderDarkColorChange', { detail: color }))
  } catch {
    // Ignore localStorage errors
  }
}

const SettingColorRow: React.FC<{
  label: string
  selectedColor: string
  onSelectColor: (color: string) => void
  colorPickerRef: React.RefObject<HTMLInputElement>
}> = ({ label, selectedColor, onSelectColor, colorPickerRef }) => (
  <div className='space-y-2'>
    <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>{label}</span>
    <div className='flex items-center gap-2 flex-wrap'>
      {TAILWIND_COLORS.map(color => (
        <button
          key={color.value}
          onClick={() => onSelectColor(color.value)}
          className={`w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 ${
            selectedColor === color.value
              ? 'border-blue-500 ring-2 ring-blue-500/30'
              : 'border-neutral-300 dark:border-neutral-600'
          }`}
          style={{ backgroundColor: color.value }}
          title={color.name}
        />
      ))}
      <button
        onClick={() => colorPickerRef.current?.click()}
        className={`w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 flex items-center justify-center ${
          !TAILWIND_COLORS.some(color => color.value === selectedColor)
            ? 'border-blue-500 ring-2 ring-blue-500/30'
            : 'border-neutral-300 dark:border-neutral-600'
        }`}
        style={{
          background: !TAILWIND_COLORS.some(color => color.value === selectedColor)
            ? selectedColor
            : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
        }}
        title='Custom color'
      >
        <input
          ref={colorPickerRef}
          type='color'
          value={selectedColor}
          onChange={e => onSelectColor(e.target.value)}
          className='sr-only'
        />
      </button>
    </div>
  </div>
)

const ChatInputBorderPreview: React.FC<{
  animationType: ChatInputBorderAnimationType
  lightColor: string
  darkColor: string
}> = ({ animationType, lightColor, darkColor }) => {
  const previewClassName =
    animationType === 'none'
      ? 'chat-input-border-preview chat-input-border-preview-none'
      : `chat-input-border-preview chat-input-border-anim chat-input-border-${animationType}`

  return (
    <div
      className={previewClassName}
      style={
        {
          '--chat-input-border-light': lightColor,
          '--chat-input-border-dark': darkColor,
        } as React.CSSProperties
      }
    >
      <div className='chat-input-border-preview-inner'></div>
    </div>
  )
}

export const ChatInputBorderAnimationSettings: React.FC = () => {
  const [expanded, setExpanded] = useState(false)
  const [selectedAnimation, setSelectedAnimation] = useState<ChatInputBorderAnimationType>(
    getStoredChatInputBorderAnimation
  )
  const [selectedLightColor, setSelectedLightColor] = useState<string>(getStoredChatInputBorderLightColor)
  const [selectedDarkColor, setSelectedDarkColor] = useState<string>(getStoredChatInputBorderDarkColor)
  const lightColorPickerRef = useRef<HTMLInputElement>(null)
  const darkColorPickerRef = useRef<HTMLInputElement>(null)

  const handleSelectAnimation = useCallback((animation: ChatInputBorderAnimationType) => {
    setSelectedAnimation(animation)
    saveChatInputBorderAnimation(animation)
  }, [])

  const handleSelectLightColor = useCallback((color: string) => {
    setSelectedLightColor(color)
    saveChatInputBorderLightColor(color)
  }, [])

  const handleSelectDarkColor = useCallback((color: string) => {
    setSelectedDarkColor(color)
    saveChatInputBorderDarkColor(color)
  }, [])

  const selectedAnimationName = useMemo(
    () => CHAT_INPUT_BORDER_ANIMATIONS.find(animation => animation.id === selectedAnimation)?.name ?? 'Digital Breath',
    [selectedAnimation]
  )

  return (
    <div className='space-y-2'>
      <button
        type='button'
        onClick={() => setExpanded(!expanded)}
        className='w-full flex items-center justify-between py-2'
      >
        <span className='text-md font-medium text-stone-700 dark:text-stone-200'>Chat Input Border Animation</span>
        <div className='flex items-center gap-2'>
          <div className='flex items-center gap-1'>
            <div
              className='w-4 h-4 rounded border border-neutral-300 dark:border-neutral-600'
              style={{ backgroundColor: selectedLightColor }}
              title='Light mode color'
            />
            <div
              className='w-4 h-4 rounded border border-neutral-300 dark:border-neutral-600'
              style={{ backgroundColor: selectedDarkColor }}
              title='Dark mode color'
            />
          </div>
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>{selectedAnimationName}</span>
          <i className={`bx ${expanded ? 'bx-chevron-up' : 'bx-chevron-down'} text-lg text-neutral-500`}></i>
        </div>
      </button>

      {expanded && (
        <div className='pt-2 space-y-4'>
          <p className='text-xs text-neutral-500 dark:text-neutral-400'>
            Animate the composer border in chat mode. Plan mode keeps its own static border style.
          </p>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <SettingColorRow
              label='Light Mode Color'
              selectedColor={selectedLightColor}
              onSelectColor={handleSelectLightColor}
              colorPickerRef={lightColorPickerRef}
            />
            <SettingColorRow
              label='Dark Mode Color'
              selectedColor={selectedDarkColor}
              onSelectColor={handleSelectDarkColor}
              colorPickerRef={darkColorPickerRef}
            />
          </div>

          <div className='space-y-2'>
            <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Animation Style</span>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
              {CHAT_INPUT_BORDER_ANIMATIONS.map(animation => (
                <button
                  key={animation.id}
                  onClick={() => handleSelectAnimation(animation.id)}
                  className={`flex flex-col items-start gap-3 p-3 rounded-xl border text-left transition-all duration-150 ${
                    selectedAnimation === animation.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                  }`}
                  title={animation.name}
                >
                  <div className='w-full rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white dark:bg-neutral-950/70 px-3 py-3 overflow-hidden shadow-sm dark:shadow-none'>
                    <ChatInputBorderPreview
                      animationType={animation.id}
                      lightColor={selectedLightColor}
                      darkColor={selectedDarkColor}
                    />
                  </div>
                  <div className='space-y-1'>
                    <div className='text-sm font-medium text-neutral-700 dark:text-neutral-200'>{animation.name}</div>
                    <div className='text-xs text-neutral-500 dark:text-neutral-400'>{animation.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
