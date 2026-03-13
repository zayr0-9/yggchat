import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  type ChatThemeRoleKey,
  type CustomChatTheme,
  createDefaultCustomChatTheme,
  type HeimdallNodeThemeKey,
  sanitizeCustomTheme,
  saveCustomChatTheme,
  setCustomChatThemeEnabled,
  useCustomChatTheme,
} from './themeConfig'

const ROLE_LABELS: Record<ChatThemeRoleKey, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  ex_agent: 'Claude Code',
  unknown: 'Unknown',
}

const NODE_LABELS: Record<HeimdallNodeThemeKey, string> = {
  user: 'User nodes',
  assistant: 'Assistant nodes',
  ex_agent: 'Claude Code nodes',
}

const ROLE_KEYS: ChatThemeRoleKey[] = ['user', 'assistant', 'system', 'ex_agent', 'unknown']
const NODE_KEYS: HeimdallNodeThemeKey[] = ['user', 'assistant', 'ex_agent']

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
}

const toHex2 = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')

const rgbToHex = (r: number, g: number, b: number) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`

const parseHexColor = (value: string): RgbaColor | null => {
  const hex = value.trim().replace('#', '')

  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 1,
    }
  }

  if (hex.length === 4) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: clamp(parseInt(hex[3] + hex[3], 16) / 255, 0, 1),
    }
  }

  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    }
  }

  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: clamp(parseInt(hex.slice(6, 8), 16) / 255, 0, 1),
    }
  }

  return null
}

const parseRgbFunctionColor = (value: string): RgbaColor | null => {
  const match = value
    .trim()
    .match(/^rgba?\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d*(?:\.\d+)?))?\s*\)$/i)

  if (!match) return null

  const r = clamp(Number(match[1]), 0, 255)
  const g = clamp(Number(match[2]), 0, 255)
  const b = clamp(Number(match[3]), 0, 255)
  const a = clamp(match[4] == null || match[4] === '' ? 1 : Number(match[4]), 0, 1)

  if ([r, g, b, a].some(num => Number.isNaN(num))) {
    return null
  }

  return { r, g, b, a }
}

const parseColorValue = (value: string): RgbaColor | null => {
  const trimmed = value.trim().toLowerCase()

  if (!trimmed) return null
  if (trimmed === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  if (trimmed.startsWith('#')) {
    return parseHexColor(trimmed)
  }

  if (trimmed.startsWith('rgb')) {
    return parseRgbFunctionColor(trimmed)
  }

  return null
}

const toCssRgba = ({ r, g, b, a }: RgbaColor) => {
  const alpha = Math.round(clamp(a, 0, 1) * 100) / 100
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`
}

type ModeColorInputProps = {
  modeLabel: string
  value: string
  onChange: (nextValue: string) => void
}

const ModeColorInput: React.FC<ModeColorInputProps> = ({ modeLabel, value, onChange }) => {
  const parsed = parseColorValue(value) ?? { r: 0, g: 0, b: 0, a: 1 }
  const pickerValue = rgbToHex(parsed.r, parsed.g, parsed.b)
  const alphaPercent = Math.round(parsed.a * 100)

  return (
    <div className='space-y-2'>
      <span className='text-[11px] uppercase tracking-[0.09em] text-neutral-500 dark:text-neutral-400'>{modeLabel}</span>

      <div className='flex items-center gap-2'>
        <div
          className='h-8 w-8 rounded border border-neutral-300 dark:border-neutral-600'
          style={{
            backgroundImage:
              'linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.08) 75%, rgba(0,0,0,0.08)), linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.08) 75%, rgba(0,0,0,0.08))',
            backgroundPosition: '0 0, 6px 6px',
            backgroundSize: '12px 12px',
          }}
        >
          <div className='h-full w-full rounded' style={{ backgroundColor: toCssRgba(parsed) }} />
        </div>
        <input
          type='color'
          value={pickerValue}
          onChange={e => {
            const rgb = parseHexColor(e.target.value)
            if (!rgb) return
            onChange(toCssRgba({ ...rgb, a: parsed.a }))
          }}
          className='h-8 w-10 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600 bg-transparent'
          title={`${modeLabel} color`}
        />
        <input
          type='text'
          value={value}
          onChange={e => onChange(e.target.value)}
          className='flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1 text-xs font-mono text-neutral-700 dark:text-neutral-200'
        />
      </div>

      <div className='flex items-center gap-2'>
        <span className='text-[11px] text-neutral-500 dark:text-neutral-400 w-10'>Alpha</span>
        <input
          type='range'
          min={0}
          max={100}
          step={1}
          value={alphaPercent}
          onChange={e => {
            const nextAlpha = clamp(Number(e.target.value), 0, 100) / 100
            onChange(toCssRgba({ ...parsed, a: nextAlpha }))
          }}
          className='flex-1 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500'
        />
        <span className='text-[11px] font-mono text-neutral-500 dark:text-neutral-400 w-9 text-right'>{alphaPercent}%</span>
      </div>
    </div>
  )
}

type PairEditorProps = {
  label: string
  value: { light: string; dark: string }
  onChange: (mode: 'light' | 'dark', nextValue: string) => void
}

const PairEditor: React.FC<PairEditorProps> = ({ label, value, onChange }) => {
  return (
    <div className='rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-2'>
      <p className='text-sm font-medium text-neutral-700 dark:text-neutral-200'>{label}</p>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
        <ModeColorInput modeLabel='Light' value={value.light} onChange={next => onChange('light', next)} />
        <ModeColorInput modeLabel='Dark' value={value.dark} onChange={next => onChange('dark', next)} />
      </div>
    </div>
  )
}

export const ThemeManager: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [status, setStatusState] = useState<{ text: string; tone: 'success' | 'error' } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const { theme, enabled } = useCustomChatTheme()

  const setStatus = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    setStatusState({ text, tone })
    window.setTimeout(() => {
      setStatusState(prev => (prev?.text === text ? null : prev))
    }, 2500)
  }, [])

  const updateTheme = useCallback(
    (updater: (current: CustomChatTheme) => CustomChatTheme) => {
      const nextTheme = updater(theme)
      saveCustomChatTheme(nextTheme)
      // UX: as soon as a user edits theme values, immediately enable custom theme.
      if (!enabled) {
        setCustomChatThemeEnabled(true)
      }
    },
    [enabled, theme]
  )

  const handleToggleEnabled = useCallback(() => {
    setCustomChatThemeEnabled(!enabled)
  }, [enabled])

  const handleThemeNameChange = useCallback(
    (nextName: string) => {
      updateTheme(current => ({
        ...current,
        name: nextName,
      }))
    },
    [updateTheme]
  )

  const handleCombinedChatSurfaceChange = useCallback(
    (mode: 'light' | 'dark', nextValue: string) => {
      updateTheme(current => ({
        ...current,
        colors: {
          ...current.colors,
          chatPanelBg: {
            ...current.colors.chatPanelBg,
            [mode]: nextValue,
          },
          chatMessageListBg: {
            ...current.colors.chatMessageListBg,
            [mode]: nextValue,
          },
        },
      }))
    },
    [updateTheme]
  )

  const handleChatSurfaceChange = useCallback(
    (
      key:
        | 'heimdallPanelBg'
        | 'conversationToolbarBg'
        | 'settingsSolidColorSectionBg'
        | 'appBackgroundColor'
        | 'settingsPaneBodyBg'
        | 'chatInputAreaBorder'
        | 'chatProgressBarFill'
        | 'actionPopoverBorder'
        | 'sendButtonAnimationColor'
        | 'streamingAnimationColor'
        | 'heimdallNotePillBg'
        | 'heimdallNotePillText'
        | 'heimdallNotePillBorder',
      mode: 'light' | 'dark',
      nextValue: string
    ) => {
      updateTheme(current => ({
        ...current,
        colors: {
          ...current.colors,
          [key]: {
            ...current.colors[key],
            [mode]: nextValue,
          },
        },
      }))
    },
    [updateTheme]
  )

  const handleRoleColorChange = useCallback(
    (
      role: ChatThemeRoleKey,
      key: 'containerBg' | 'border' | 'roleText',
      mode: 'light' | 'dark',
      nextValue: string
    ) => {
      updateTheme(current => ({
        ...current,
        colors: {
          ...current.colors,
          messageRoles: {
            ...current.colors.messageRoles,
            [role]: {
              ...current.colors.messageRoles[role],
              [key]: {
                ...current.colors.messageRoles[role][key],
                [mode]: nextValue,
              },
            },
          },
        },
      }))
    },
    [updateTheme]
  )

  const handleNodeColorChange = useCallback(
    (
      sender: HeimdallNodeThemeKey,
      key: 'fill' | 'stroke' | 'visibleStroke',
      mode: 'light' | 'dark',
      nextValue: string
    ) => {
      updateTheme(current => ({
        ...current,
        colors: {
          ...current.colors,
          heimdallNodes: {
            ...current.colors.heimdallNodes,
            [sender]: {
              ...current.colors.heimdallNodes[sender],
              [key]: {
                ...current.colors.heimdallNodes[sender][key],
                [mode]: nextValue,
              },
            },
          },
        },
      }))
    },
    [updateTheme]
  )

  const applyImportedTheme = useCallback(
    (rawTheme: string, sourceLabel: string) => {
      try {
        const parsed = JSON.parse(rawTheme)
        const nextTheme = sanitizeCustomTheme(parsed)
        saveCustomChatTheme(nextTheme)
        setCustomChatThemeEnabled(true)
        setStatus(`Theme loaded from ${sourceLabel}`)
      } catch (error) {
        setStatus(error instanceof Error ? `Failed to import theme: ${error.message}` : 'Failed to import theme', 'error')
      }
    },
    [setStatus]
  )

  const handleImportFromDisk = useCallback(async () => {
    try {
      const electronApi = window.electronAPI
      if (electronApi?.dialog?.openFile && electronApi?.fs?.readFile) {
        const result = await electronApi.dialog.openFile({
          title: 'Import Theme JSON',
          filters: [{ name: 'JSON', extensions: ['json'] }],
          properties: ['openFile'],
        })

        if (!result?.success || !result.filePath) {
          return
        }

        const readResult = await electronApi.fs.readFile(result.filePath, 'utf8')
        if (typeof readResult === 'string') {
          applyImportedTheme(readResult, result.filePath)
          return
        }

        if (!readResult?.success || typeof readResult.content !== 'string') {
          throw new Error(readResult?.error || 'Unable to read selected theme file')
        }

        applyImportedTheme(readResult.content, result.filePath)
        return
      }

      importInputRef.current?.click()
    } catch (error) {
      setStatus(error instanceof Error ? `Failed to open theme file: ${error.message}` : 'Failed to open theme file', 'error')
    }
  }, [applyImportedTheme, setStatus])

  const handleImportInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return

      try {
        const rawTheme = await file.text()
        applyImportedTheme(rawTheme, file.name)
      } catch (error) {
        setStatus(error instanceof Error ? `Failed to read theme file: ${error.message}` : 'Failed to read theme file', 'error')
      }
    },
    [applyImportedTheme, setStatus]
  )

  const handleExport = useCallback(() => {
    const safeName = (theme.name || 'custom-theme').trim().replace(/[^a-z0-9-_]+/gi, '-') || 'custom-theme'
    const payload = JSON.stringify(theme, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeName.toLowerCase()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    setStatus('Theme exported as JSON')
  }, [setStatus, theme])

  const handleReset = useCallback(() => {
    const confirmed = window.confirm('Reset custom theme colors to defaults?')
    if (!confirmed) return
    saveCustomChatTheme(createDefaultCustomChatTheme())
    setStatus('Theme reset to defaults')
  }, [setStatus])

  const summary = useMemo(() => (enabled ? theme.name || 'Custom Theme' : 'Disabled'), [enabled, theme.name])

  return (
    <div className='space-y-2'>
      <button
        type='button'
        onClick={() => setIsExpanded(prev => !prev)}
        className='w-full flex items-center justify-between py-2 text-left'
      >
        <span className='text-[16px] font-medium text-stone-700 dark:text-stone-200'>Custom Theme</span>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>{summary}</span>
          <i className={`bx ${isExpanded ? 'bx-chevron-up' : 'bx-chevron-down'} text-lg text-neutral-500`}></i>
        </div>
      </button>

      {isExpanded && (
        <div className='space-y-4 pl-1 pt-1'>
          <div className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/30 px-3 py-2'>
            <div>
              <p className='text-sm font-medium text-stone-700 dark:text-stone-200'>Enable custom theme</p>
              <p className='text-xs text-neutral-500 dark:text-neutral-400'>Apply your color overrides to chat and Heimdall.</p>
            </div>
            <button
              type='button'
              onClick={handleToggleEnabled}
              className='p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors'
              title={enabled ? 'Disable custom theme' : 'Enable custom theme'}
              aria-pressed={enabled}
            >
              <i className={`bx ${enabled ? 'bx-toggle-right text-green-500' : 'bx-toggle-left text-neutral-400'} text-2xl`} />
            </button>
          </div>

          <div className='space-y-2'>
            <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Theme name</label>
            <input
              type='text'
              value={theme.name}
              onChange={e => handleThemeNameChange(e.target.value)}
              className='w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-800 dark:text-neutral-100'
              placeholder='My Custom Theme'
            />
          </div>

          <div className='space-y-3'>
            <h4 className='text-sm font-semibold text-stone-700 dark:text-stone-200'>Chat surfaces</h4>
            <PairEditor
              label='Chat panel + message list background'
              value={theme.colors.chatPanelBg}
              onChange={handleCombinedChatSurfaceChange}
            />
            <PairEditor
              label='Heimdall background'
              value={theme.colors.heimdallPanelBg}
              onChange={(mode, value) => handleChatSurfaceChange('heimdallPanelBg', mode, value)}
            />
            <PairEditor
              label='Conversation toolbar bubble'
              value={theme.colors.conversationToolbarBg}
              onChange={(mode, value) => handleChatSurfaceChange('conversationToolbarBg', mode, value)}
            />
            <PairEditor
              label='Settings solid-color section background'
              value={theme.colors.settingsSolidColorSectionBg}
              onChange={(mode, value) => handleChatSurfaceChange('settingsSolidColorSectionBg', mode, value)}
            />
            <PairEditor
              label='App solid background colors (Settings > Solid Color Background)'
              value={theme.colors.appBackgroundColor}
              onChange={(mode, value) => handleChatSurfaceChange('appBackgroundColor', mode, value)}
            />
            <PairEditor
              label='Settings pane full body background'
              value={theme.colors.settingsPaneBodyBg}
              onChange={(mode, value) => handleChatSurfaceChange('settingsPaneBodyBg', mode, value)}
            />
            <PairEditor
              label='Chat input area border'
              value={theme.colors.chatInputAreaBorder}
              onChange={(mode, value) => handleChatSurfaceChange('chatInputAreaBorder', mode, value)}
            />
            <PairEditor
              label='Chat progress bar fill'
              value={theme.colors.chatProgressBarFill}
              onChange={(mode, value) => handleChatSurfaceChange('chatProgressBarFill', mode, value)}
            />
            <PairEditor
              label='Action popover border'
              value={theme.colors.actionPopoverBorder}
              onChange={(mode, value) => handleChatSurfaceChange('actionPopoverBorder', mode, value)}
            />
            <PairEditor
              label='Send button loading animation color'
              value={theme.colors.sendButtonAnimationColor}
              onChange={(mode, value) => handleChatSurfaceChange('sendButtonAnimationColor', mode, value)}
            />
            <PairEditor
              label='Streaming loading animation color'
              value={theme.colors.streamingAnimationColor}
              onChange={(mode, value) => handleChatSurfaceChange('streamingAnimationColor', mode, value)}
            />
          </div>

          <div className='space-y-3'>
            <h4 className='text-sm font-semibold text-stone-700 dark:text-stone-200'>Message role colors</h4>
            {ROLE_KEYS.map(role => (
              <div key={role} className='rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-3'>
                <p className='text-sm font-medium text-stone-700 dark:text-stone-200'>{ROLE_LABELS[role]}</p>
                <PairEditor
                  label='Container background'
                  value={theme.colors.messageRoles[role].containerBg}
                  onChange={(mode, value) => handleRoleColorChange(role, 'containerBg', mode, value)}
                />
                <PairEditor
                  label='Border color'
                  value={theme.colors.messageRoles[role].border}
                  onChange={(mode, value) => handleRoleColorChange(role, 'border', mode, value)}
                />
                <PairEditor
                  label='Role text color'
                  value={theme.colors.messageRoles[role].roleText}
                  onChange={(mode, value) => handleRoleColorChange(role, 'roleText', mode, value)}
                />
              </div>
            ))}
          </div>

          <div className='space-y-3'>
            <h4 className='text-sm font-semibold text-stone-700 dark:text-stone-200'>Heimdall node colors</h4>
            <PairEditor
              label='Heimdall note pill background'
              value={theme.colors.heimdallNotePillBg}
              onChange={(mode, value) => handleChatSurfaceChange('heimdallNotePillBg', mode, value)}
            />
            <PairEditor
              label='Heimdall note pill text'
              value={theme.colors.heimdallNotePillText}
              onChange={(mode, value) => handleChatSurfaceChange('heimdallNotePillText', mode, value)}
            />
            <PairEditor
              label='Heimdall note pill border'
              value={theme.colors.heimdallNotePillBorder}
              onChange={(mode, value) => handleChatSurfaceChange('heimdallNotePillBorder', mode, value)}
            />
            {NODE_KEYS.map(sender => (
              <div key={sender} className='rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 space-y-3'>
                <p className='text-sm font-medium text-stone-700 dark:text-stone-200'>{NODE_LABELS[sender]}</p>
                <PairEditor
                  label='Node fill'
                  value={theme.colors.heimdallNodes[sender].fill}
                  onChange={(mode, value) => handleNodeColorChange(sender, 'fill', mode, value)}
                />
                <PairEditor
                  label='Node stroke'
                  value={theme.colors.heimdallNodes[sender].stroke}
                  onChange={(mode, value) => handleNodeColorChange(sender, 'stroke', mode, value)}
                />
                <PairEditor
                  label='Visible node stroke'
                  value={theme.colors.heimdallNodes[sender].visibleStroke}
                  onChange={(mode, value) => handleNodeColorChange(sender, 'visibleStroke', mode, value)}
                />
              </div>
            ))}
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <input
              ref={importInputRef}
              type='file'
              accept='application/json,.json'
              className='hidden'
              onChange={handleImportInputChange}
            />
            <button
              type='button'
              onClick={handleImportFromDisk}
              className='px-3 py-2 rounded-lg text-sm bg-emerald-500 text-white hover:bg-emerald-600 transition-colors'
            >
              Import Theme JSON
            </button>
            <button
              type='button'
              onClick={handleExport}
              className='px-3 py-2 rounded-lg text-sm bg-blue-500 text-white hover:bg-blue-600 transition-colors'
            >
              Export Theme JSON
            </button>
            <button
              type='button'
              onClick={handleReset}
              className='px-3 py-2 rounded-lg text-sm border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors'
            >
              Reset to defaults
            </button>
            {status && (
              <span
                className={`text-xs ${
                  status.tone === 'error'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {status.text}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
