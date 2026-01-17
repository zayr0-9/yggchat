import React, { useCallback, useRef, useState } from 'react'
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

export const SEND_BUTTON_ANIMATION_STORAGE_KEY = 'chat:sendButtonAnimation'
export const SEND_BUTTON_COLOR_STORAGE_KEY = 'chat:sendButtonColor'

const ANIMATIONS: { id: SendButtonAnimationType; name: string }[] = [
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
    if (stored && ANIMATIONS.some(a => a.id === stored)) {
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

const AnimationPreview: React.FC<{ animationType: SendButtonAnimationType; bgColor: string }> = ({
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

export const SendButtonAnimationSettings: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedAnimation, setSelectedAnimation] = useState<SendButtonAnimationType>(getStoredSendButtonAnimation)
  const [selectedColor, setSelectedColor] = useState<string>(getStoredSendButtonColor)
  const colorPickerRef = useRef<HTMLInputElement>(null)

  const handleSelectAnimation = useCallback((animation: SendButtonAnimationType) => {
    setSelectedAnimation(animation)
    saveSendButtonAnimation(animation)
  }, [])

  const handleSelectColor = useCallback((color: string) => {
    setSelectedColor(color)
    saveSendButtonColor(color)
  }, [])

  const selectedAnimationName = ANIMATIONS.find(a => a.id === selectedAnimation)?.name || 'Pulse Orbit'

  return (
    <div className='space-y-2'>
      <button
        type='button'
        onClick={() => setIsExpanded(!isExpanded)}
        className='w-full flex items-center justify-between py-2'
      >
        <span className='text-sm font-medium text-stone-700 dark:text-stone-200'>Send Button Animation</span>
        <div className='flex items-center gap-2'>
          <div
            className='w-5 h-5 rounded border border-neutral-300 dark:border-neutral-600'
            style={{ backgroundColor: selectedColor }}
          />
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>{selectedAnimationName}</span>
          <i className={`bx ${isExpanded ? 'bx-chevron-up' : 'bx-chevron-down'} text-lg text-neutral-500`}></i>
        </div>
      </button>

      {isExpanded && (
        <div className='pt-2 space-y-4'>
          <p className='text-xs text-neutral-500 dark:text-neutral-400'>
            Choose an animation to display while the AI is generating a response.
          </p>

          {/* Color Selection */}
          <div className='space-y-2'>
            <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Background Color</span>
            <div className='flex items-center gap-2 flex-wrap'>
              {TAILWIND_COLORS.map(color => (
                <button
                  key={color.value}
                  onClick={() => handleSelectColor(color.value)}
                  className={`w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 ${
                    selectedColor === color.value
                      ? 'border-blue-500 ring-2 ring-blue-500/30'
                      : 'border-neutral-300 dark:border-neutral-600'
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                />
              ))}
              {/* Custom color picker */}
              <button
                onClick={() => colorPickerRef.current?.click()}
                className={`w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 flex items-center justify-center ${
                  !TAILWIND_COLORS.some(c => c.value === selectedColor)
                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                    : 'border-neutral-300 dark:border-neutral-600'
                }`}
                style={{
                  background: !TAILWIND_COLORS.some(c => c.value === selectedColor)
                    ? selectedColor
                    : 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                }}
                title='Custom color'
              >
                <input
                  ref={colorPickerRef}
                  type='color'
                  value={selectedColor}
                  onChange={e => handleSelectColor(e.target.value)}
                  className='sr-only'
                />
              </button>
            </div>
          </div>

          {/* Animation Selection */}
          <div className='space-y-2'>
            <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Animation Style</span>
            <div className='grid grid-cols-5 gap-3'>
              {ANIMATIONS.map(animation => (
                <button
                  key={animation.id}
                  onClick={() => handleSelectAnimation(animation.id)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-150 ${
                    selectedAnimation === animation.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                  }`}
                  title={animation.name}
                >
                  <AnimationPreview animationType={animation.id} bgColor={selectedColor} />
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
