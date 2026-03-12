import React, { useCallback, useMemo, useRef, useState } from 'react'
import './SendButtonAnimations.css'

export type SendButtonAnimationType =
  | 'pulse-orbit'
  | 'ellipsis-flow'
  | 'liquid-fill'
  | 'neutral-bond'
  | 'geom-aperture'
  | 'neural-flux'
  | 'data-drift'
  | 'inertia'
  | 'binary-swap'
  | 'pulse-freq'

export type StreamingAnimationType =
  | 'data-wave'
  | 'digital-breath'
  | 'neural-fragments'
  | 'binary-flow'
  | 'prism-bloom'
  | 'orbit-rings'
  | 'shard-sweep'

export const SEND_BUTTON_ANIMATION_STORAGE_KEY = 'chat:sendButtonAnimation'
export const SEND_BUTTON_COLOR_STORAGE_KEY = 'chat:sendButtonColor'
export const STREAMING_ANIMATION_STORAGE_KEY = 'chat:streamingAnimation'
export const STREAMING_COLOR_STORAGE_KEY = 'chat:streamingAnimationColor'
export const STREAMING_LIGHT_COLOR_STORAGE_KEY = 'chat:streamingAnimationLightColor'
export const STREAMING_DARK_COLOR_STORAGE_KEY = 'chat:streamingAnimationDarkColor'
export const STREAMING_SPEED_STORAGE_KEY = 'chat:streamingAnimationSpeed'

const SEND_BUTTON_ANIMATIONS: { id: SendButtonAnimationType; name: string }[] = [
  { id: 'pulse-orbit', name: 'Pulse Orbit' },
  { id: 'ellipsis-flow', name: 'Ellipsis Flow' },
  { id: 'liquid-fill', name: 'Liquid Fill' },
  { id: 'neutral-bond', name: 'Neutral Bond' },
  { id: 'geom-aperture', name: 'Geometric Aperture' },
  { id: 'neural-flux', name: 'Neural Flux' },
  { id: 'data-drift', name: 'Data Drift' },
  { id: 'inertia', name: 'Inertia' },
  { id: 'binary-swap', name: 'Binary Swap' },
  { id: 'pulse-freq', name: 'Pulse Freq' },
]

const STREAMING_ANIMATIONS: { id: StreamingAnimationType; name: string; description: string }[] = [
  {
    id: 'data-wave',
    name: 'Data Wave',
    description: '8×2 cube grid that pulses, grows, and twists in a staggered wave.',
  },
  {
    id: 'digital-breath',
    name: 'Digital Breath',
    description: 'Outlined squares expand and contract asynchronously with a light, modern feel.',
  },
  {
    id: 'neural-fragments',
    name: 'Neural Fragments',
    description: 'Floating fragments spin with subtle depth and glow like a thinking mesh.',
  },
  {
    id: 'binary-flow',
    name: 'Binary Flow',
    description: 'Columns of bits slide vertically with shifting opacity like streaming data.',
  },
  {
    id: 'prism-bloom',
    name: 'Prism Bloom',
    description: 'Diamond prisms flare outward and fold back like a crystalline pulse.',
  },
  {
    id: 'orbit-rings',
    name: 'Orbit Rings',
    description: 'A tiny core with rotating rings and satellites for a futuristic signal look.',
  },
  {
    id: 'shard-sweep',
    name: 'Shard Sweep',
    description: 'Angular shards sweep diagonally in layered passes like scanning fragments.',
  },
]

const TAILWIND_COLORS = [
  { name: 'White', value: '#ffffff' },
  { name: 'Slate', value: '#64748b' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Purple', value: '#a855f7' },
]

export const getStoredSendButtonAnimation = (): SendButtonAnimationType => {
  try {
    const stored = localStorage.getItem(SEND_BUTTON_ANIMATION_STORAGE_KEY)
    if (stored && SEND_BUTTON_ANIMATIONS.some(animation => animation.id === stored)) {
      return stored as SendButtonAnimationType
    }
  } catch {
    // Ignore localStorage errors
  }
  return 'pulse-orbit'
}

export const getStoredSendButtonColor = (): string => {
  try {
    const stored = localStorage.getItem(SEND_BUTTON_COLOR_STORAGE_KEY)
    if (stored) return stored
  } catch {
    // Ignore localStorage errors
  }
  return '#ffffff'
}

export const getStoredStreamingAnimation = (): StreamingAnimationType => {
  try {
    const stored = localStorage.getItem(STREAMING_ANIMATION_STORAGE_KEY)
    if (stored && STREAMING_ANIMATIONS.some(animation => animation.id === stored)) {
      return stored as StreamingAnimationType
    }
  } catch {
    // Ignore localStorage errors
  }
  return 'data-wave'
}

export const getStoredStreamingColor = (): string => {
  try {
    const stored = localStorage.getItem(STREAMING_COLOR_STORAGE_KEY)
    if (stored) return stored
  } catch {
    // Ignore localStorage errors
  }
  return '#ef4444'
}

export const getStoredStreamingLightColor = (): string => {
  try {
    const stored = localStorage.getItem(STREAMING_LIGHT_COLOR_STORAGE_KEY)
    if (stored) return stored
    const legacy = localStorage.getItem(STREAMING_COLOR_STORAGE_KEY)
    if (legacy) return legacy
  } catch {
    // Ignore localStorage errors
  }
  return '#ef4444'
}

export const getStoredStreamingDarkColor = (): string => {
  try {
    const stored = localStorage.getItem(STREAMING_DARK_COLOR_STORAGE_KEY)
    if (stored) return stored
    const legacy = localStorage.getItem(STREAMING_COLOR_STORAGE_KEY)
    if (legacy) return legacy
  } catch {
    // Ignore localStorage errors
  }
  return '#ffffff'
}

export const getStoredStreamingSpeed = (): number => {
  try {
    const stored = localStorage.getItem(STREAMING_SPEED_STORAGE_KEY)
    const parsed = stored ? Number.parseFloat(stored) : Number.NaN
    if (Number.isFinite(parsed)) {
      return Math.max(0.5, Math.min(2, parsed))
    }
  } catch {
    // Ignore localStorage errors
  }
  return 1
}

export const saveSendButtonAnimation = (animation: SendButtonAnimationType): void => {
  try {
    localStorage.setItem(SEND_BUTTON_ANIMATION_STORAGE_KEY, animation)
    window.dispatchEvent(new CustomEvent('sendButtonAnimationChange', { detail: animation }))
  } catch {
    // Ignore localStorage errors
  }
}

export const saveSendButtonColor = (color: string): void => {
  try {
    localStorage.setItem(SEND_BUTTON_COLOR_STORAGE_KEY, color)
    window.dispatchEvent(new CustomEvent('sendButtonColorChange', { detail: color }))
  } catch {
    // Ignore localStorage errors
  }
}

export const saveStreamingAnimation = (animation: StreamingAnimationType): void => {
  try {
    localStorage.setItem(STREAMING_ANIMATION_STORAGE_KEY, animation)
    window.dispatchEvent(new CustomEvent('streamingAnimationChange', { detail: animation }))
  } catch {
    // Ignore localStorage errors
  }
}

export const saveStreamingColor = (color: string): void => {
  try {
    localStorage.setItem(STREAMING_COLOR_STORAGE_KEY, color)
    window.dispatchEvent(new CustomEvent('streamingAnimationColorChange', { detail: color }))
  } catch {
    // Ignore localStorage errors
  }
}

export const saveStreamingLightColor = (color: string): void => {
  try {
    localStorage.setItem(STREAMING_LIGHT_COLOR_STORAGE_KEY, color)
    window.dispatchEvent(new CustomEvent('streamingAnimationLightColorChange', { detail: color }))
  } catch {
    // Ignore localStorage errors
  }
}

export const saveStreamingDarkColor = (color: string): void => {
  try {
    localStorage.setItem(STREAMING_DARK_COLOR_STORAGE_KEY, color)
    window.dispatchEvent(new CustomEvent('streamingAnimationDarkColorChange', { detail: color }))
  } catch {
    // Ignore localStorage errors
  }
}

export const saveStreamingSpeed = (speed: number): void => {
  try {
    const next = Math.max(0.5, Math.min(2, speed))
    localStorage.setItem(STREAMING_SPEED_STORAGE_KEY, String(next))
    window.dispatchEvent(new CustomEvent('streamingAnimationSpeedChange', { detail: next }))
  } catch {
    // Ignore localStorage errors
  }
}

const SendButtonPreview: React.FC<{ animationType: SendButtonAnimationType; bgColor: string }> = ({
  animationType,
  bgColor,
}) => {
  const style = { '--send-btn-bg': bgColor } as React.CSSProperties

  switch (animationType) {
    case 'ellipsis-flow':
      return (
        <div className='send-btn-preview ellipsis-flow' style={style}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      )
    case 'data-drift':
      return (
        <div className='send-btn-preview data-drift' style={style}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      )
    case 'binary-swap':
      return (
        <div className='send-btn-preview binary-swap' style={style}>
          <span></span>
          <span></span>
        </div>
      )
    case 'pulse-freq':
      return (
        <div className='send-btn-preview pulse-freq' style={style}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      )
    default:
      return <div className={`send-btn-preview ${animationType}`} style={style}></div>
  }
}

const buildStreamingStyle = (
  animationType: StreamingAnimationType,
  color: string,
  speed: number,
  mode: 'preview' | 'live'
): React.CSSProperties => {
  const clampedSpeed = Math.max(0.5, Math.min(2, speed))
  const baseDuration = 1.4 / clampedSpeed
  const isOrbitRings = animationType === 'orbit-rings'

  return {
    '--stream-anim-color': color,
    '--stream-duration': `${baseDuration}s`,
    '--stream-cell-size': mode === 'preview' ? '8px' : '10px',
    '--stream-gap': mode === 'preview' ? '4px' : '5px',
    '--stream-width': isOrbitRings
      ? mode === 'preview'
        ? '96px'
        : '112px'
      : mode === 'preview'
        ? '148px'
        : '182px',
    '--stream-height': isOrbitRings
      ? mode === 'preview'
        ? '30px'
        : '36px'
      : mode === 'preview'
        ? '18px'
        : '22px',
    '--stream-columns': isOrbitRings ? '1' : '12',
  } as React.CSSProperties
}

const StreamingAnimationVisual: React.FC<{
  animationType: StreamingAnimationType
  color: string
  speed: number
  mode: 'preview' | 'live'
  className?: string
}> = ({ animationType, color, speed, mode, className }) => {
  const style = buildStreamingStyle(animationType, color, speed, mode)
  const cellCount = animationType === 'orbit-rings' ? 0 : 12
  const columnCount = animationType === 'binary-flow' ? 10 : 8

  if (animationType === 'binary-flow') {
    return (
      <div className={`streaming-anim streaming-${animationType} ${mode} ${className ?? ''}`.trim()} style={style}>
        {Array.from({ length: columnCount }).map((_, index) => (
          <div
            key={index}
            className='stream-col'
            style={{
              ['--i' as string]: index,
              animationDelay: `${index * 0.05}s`,
            } as React.CSSProperties}
          >
            <span className='stream-bit top'></span>
            <span className='stream-bit bottom'></span>
          </div>
        ))}
      </div>
    )
  }

  if (animationType === 'orbit-rings') {
    return (
      <div className={`streaming-anim streaming-${animationType} ${mode} ${className ?? ''}`.trim()} style={style}>
        <span className='stream-core'></span>
        <span className='stream-ring ring-a'></span>
        <span className='stream-ring ring-b'></span>
        <span className='stream-ring ring-c'></span>
        {Array.from({ length: 4 }).map((_, index) => (
          <span
            key={index}
            className={`stream-satellite sat-${index + 1}`}
            style={{ animationDelay: `${index * 0.12}s` } as React.CSSProperties}
          ></span>
        ))}
      </div>
    )
  }

  return (
    <div className={`streaming-anim streaming-${animationType} ${mode} ${className ?? ''}`.trim()} style={style}>
      {Array.from({ length: cellCount }).map((_, index) => (
        <span
          key={index}
          className='stream-cell'
          style={{
            ['--i' as string]: index,
            animationDelay: `${index * 0.05}s`,
          } as React.CSSProperties}
        ></span>
      ))}
    </div>
  )
}

const SettingColorRow: React.FC<{
  label?: string
  selectedColor: string
  onSelectColor: (color: string) => void
  colorPickerRef: React.RefObject<HTMLInputElement>
}> = ({ label = 'Color', selectedColor, onSelectColor, colorPickerRef }) => (
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

export const SendButtonAnimationSettings: React.FC = () => {
  const [sendButtonExpanded, setSendButtonExpanded] = useState(false)
  const [streamingExpanded, setStreamingExpanded] = useState(false)
  const [selectedSendButtonAnimation, setSelectedSendButtonAnimation] =
    useState<SendButtonAnimationType>(getStoredSendButtonAnimation)
  const [selectedSendButtonColor, setSelectedSendButtonColor] = useState<string>(getStoredSendButtonColor)
  const [selectedStreamingAnimation, setSelectedStreamingAnimation] =
    useState<StreamingAnimationType>(getStoredStreamingAnimation)
  const [selectedStreamingLightColor, setSelectedStreamingLightColor] = useState<string>(getStoredStreamingLightColor)
  const [selectedStreamingDarkColor, setSelectedStreamingDarkColor] = useState<string>(getStoredStreamingDarkColor)
  const [selectedStreamingSpeed, setSelectedStreamingSpeed] = useState<number>(getStoredStreamingSpeed)
  const sendButtonColorPickerRef = useRef<HTMLInputElement>(null)
  const streamingLightColorPickerRef = useRef<HTMLInputElement>(null)
  const streamingDarkColorPickerRef = useRef<HTMLInputElement>(null)

  const handleSelectSendButtonAnimation = useCallback((animation: SendButtonAnimationType) => {
    setSelectedSendButtonAnimation(animation)
    saveSendButtonAnimation(animation)
  }, [])

  const handleSelectSendButtonColor = useCallback((color: string) => {
    setSelectedSendButtonColor(color)
    saveSendButtonColor(color)
  }, [])

  const handleSelectStreamingAnimation = useCallback((animation: StreamingAnimationType) => {
    setSelectedStreamingAnimation(animation)
    saveStreamingAnimation(animation)
  }, [])

  const handleSelectStreamingLightColor = useCallback((color: string) => {
    setSelectedStreamingLightColor(color)
    saveStreamingLightColor(color)
  }, [])

  const handleSelectStreamingDarkColor = useCallback((color: string) => {
    setSelectedStreamingDarkColor(color)
    saveStreamingDarkColor(color)
  }, [])

  const handleStreamingSpeedChange = useCallback((speed: number) => {
    const next = Math.max(0.5, Math.min(2, speed))
    setSelectedStreamingSpeed(next)
    saveStreamingSpeed(next)
  }, [])

  const selectedSendButtonAnimationName = useMemo(
    () => SEND_BUTTON_ANIMATIONS.find(animation => animation.id === selectedSendButtonAnimation)?.name || 'Pulse Orbit',
    [selectedSendButtonAnimation]
  )

  const selectedStreamingAnimationName = useMemo(
    () => STREAMING_ANIMATIONS.find(animation => animation.id === selectedStreamingAnimation)?.name || 'Data Wave',
    [selectedStreamingAnimation]
  )

  const isDarkModePreview =
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  const activeStreamingPreviewColor = isDarkModePreview ? selectedStreamingDarkColor : selectedStreamingLightColor

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <button
          type='button'
          onClick={() => setSendButtonExpanded(!sendButtonExpanded)}
          className='w-full flex items-center justify-between py-2'
        >
          <span className='text-md font-medium text-stone-700 dark:text-stone-200'>Send Button Animation</span>
          <div className='flex items-center gap-2'>
            <div
              className='w-5 h-5 rounded border border-neutral-300 dark:border-neutral-600'
              style={{ backgroundColor: selectedSendButtonColor }}
            />
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>{selectedSendButtonAnimationName}</span>
            <i className={`bx ${sendButtonExpanded ? 'bx-chevron-up' : 'bx-chevron-down'} text-lg text-neutral-500`}></i>
          </div>
        </button>

        {sendButtonExpanded && (
          <div className='pt-2 space-y-4'>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              Choose an animation to display inside the send button while the AI is generating a response.
            </p>

            <SettingColorRow
              selectedColor={selectedSendButtonColor}
              onSelectColor={handleSelectSendButtonColor}
              colorPickerRef={sendButtonColorPickerRef}
            />

            <div className='space-y-2'>
              <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Animation Style</span>
              <div className='grid grid-cols-5 gap-3'>
                {SEND_BUTTON_ANIMATIONS.map(animation => (
                  <button
                    key={animation.id}
                    onClick={() => handleSelectSendButtonAnimation(animation.id)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-150 ${
                      selectedSendButtonAnimation === animation.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                    }`}
                    title={animation.name}
                  >
                    <SendButtonPreview animationType={animation.id} bgColor={selectedSendButtonColor} />
                    <span className='text-xs text-neutral-600 dark:text-neutral-400 text-center truncate w-full'>
                      {animation.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className='space-y-2'>
        <button
          type='button'
          onClick={() => setStreamingExpanded(!streamingExpanded)}
          className='w-full flex items-center justify-between py-2'
        >
          <span className='text-md font-medium text-stone-700 dark:text-stone-200'>Streaming Animation</span>
          <div className='flex items-center gap-2'>
            <div className='flex items-center gap-1'>
              <div
                className='w-4 h-4 rounded border border-neutral-300 dark:border-neutral-600'
                style={{ backgroundColor: selectedStreamingLightColor }}
                title='Light mode color'
              />
              <div
                className='w-4 h-4 rounded border border-neutral-300 dark:border-neutral-600'
                style={{ backgroundColor: selectedStreamingDarkColor }}
                title='Dark mode color'
              />
            </div>
            <span className='text-xs text-neutral-500 dark:text-neutral-400'>
              {selectedStreamingAnimationName} · {selectedStreamingSpeed.toFixed(1)}×
            </span>
            <i className={`bx ${streamingExpanded ? 'bx-chevron-up' : 'bx-chevron-down'} text-lg text-neutral-500`}></i>
          </div>
        </button>

        {streamingExpanded && (
          <div className='pt-2 space-y-4'>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              Pick the animation shown below the live assistant message while streaming. You can tune its color and speed.
            </p>

            <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
              <SettingColorRow
                label='Light Mode Color'
                selectedColor={selectedStreamingLightColor}
                onSelectColor={handleSelectStreamingLightColor}
                colorPickerRef={streamingLightColorPickerRef}
              />
              <SettingColorRow
                label='Dark Mode Color'
                selectedColor={selectedStreamingDarkColor}
                onSelectColor={handleSelectStreamingDarkColor}
                colorPickerRef={streamingDarkColorPickerRef}
              />
            </div>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Speed</span>
                <span className='text-xs font-mono text-neutral-500 dark:text-neutral-400'>
                  {selectedStreamingSpeed.toFixed(1)}×
                </span>
              </div>
              <div className='flex items-center gap-4'>
                <span className='text-xs text-neutral-500 dark:text-neutral-500 w-8'>0.5×</span>
                <input
                  type='range'
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={selectedStreamingSpeed}
                  onChange={e => handleStreamingSpeedChange(Number.parseFloat(e.target.value))}
                  className='flex-1 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500'
                />
                <span className='text-xs text-neutral-500 dark:text-neutral-500 w-8'>2.0×</span>
                <button
                  type='button'
                  onClick={() => handleStreamingSpeedChange(1)}
                  className={`px-3 py-1.5 rounded-lg text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors ${selectedStreamingSpeed === 1 ? 'invisible' : ''}`}
                  title='Reset speed'
                >
                  Reset
                </button>
              </div>
            </div>

            <div className='space-y-2'>
              <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Animation Style</span>
              <div className='grid grid-cols-2 gap-3'>
                {STREAMING_ANIMATIONS.map(animation => (
                  <button
                    key={animation.id}
                    onClick={() => handleSelectStreamingAnimation(animation.id)}
                    className={`flex flex-col items-start gap-3 p-3 rounded-xl border text-left transition-all duration-150 ${
                      selectedStreamingAnimation === animation.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                    }`}
                    title={animation.name}
                  >
                    <div className='w-full rounded-xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white dark:bg-neutral-950/70 px-3 py-3 overflow-hidden shadow-sm dark:shadow-none'>
                      <StreamingAnimationVisual
                        animationType={animation.id}
                        color={activeStreamingPreviewColor}
                        speed={selectedStreamingSpeed}
                        mode='preview'
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
    </div>
  )
}

export const SendButtonLoadingAnimation: React.FC<{
  animationType: SendButtonAnimationType
  bgColor?: string
}> = ({ animationType, bgColor }) => {
  const style = bgColor ? ({ '--send-btn-bg': bgColor } as React.CSSProperties) : undefined

  switch (animationType) {
    case 'ellipsis-flow':
      return (
        <div className='send-btn-loading ellipsis-flow' style={style}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      )
    case 'data-drift':
      return (
        <div className='send-btn-loading data-drift' style={style}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      )
    case 'binary-swap':
      return (
        <div className='send-btn-loading binary-swap' style={style}>
          <span></span>
          <span></span>
        </div>
      )
    case 'pulse-freq':
      return (
        <div className='send-btn-loading pulse-freq' style={style}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      )
    default:
      return <div className={`send-btn-loading ${animationType}`} style={style}></div>
  }
}

export const StreamingLoadingAnimation: React.FC<{
  animationType: StreamingAnimationType
  color?: string
  speed?: number
  className?: string
}> = ({ animationType, color = '#ef4444', speed = 1, className }) => (
  <StreamingAnimationVisual
    animationType={animationType}
    color={color}
    speed={speed}
    mode='live'
    className={className}
  />
)
