import React, { useEffect, useMemo, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Button } from '../Button/button'
import type { MonacoPaneTabItem } from '../MonacoFileEditorPane/MonacoFileEditorPane'

interface XtermTerminalPaneProps {
  tabId: string
  title: string
  cwd: string
  shell: string
  sessionId: string | null
  history: string
  status: 'launching' | 'open' | 'closed' | 'error'
  error: string | null
  exitCode: number | null
  theme: 'vs' | 'vs-dark'
  tabs: MonacoPaneTabItem[]
  activeTabId: string | null
  onInput: (data: string) => void
  onResize: (cols: number, rows: number) => void
  onRestart: () => void
  onClear: () => void
  onClose: () => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}

type XtermTheme = NonNullable<ConstructorParameters<typeof Terminal>[0]>['theme']

const createTerminalTheme = (theme: 'vs' | 'vs-dark'): XtermTheme =>
  theme === 'vs-dark'
    ? {
        background: '#0a0a0a',
        foreground: '#e5e7eb',
        cursor: '#f9fafb',
        cursorAccent: '#0a0a0a',
        selectionBackground: '#33415588',
        black: '#111827',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f3f4f6',
        brightBlack: '#6b7280',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      }
    : {
        background: '#f8fafc',
        foreground: '#0f172a',
        cursor: '#0f172a',
        cursorAccent: '#f8fafc',
        selectionBackground: '#94a3b84d',
        black: '#0f172a',
        red: '#b91c1c',
        green: '#15803d',
        yellow: '#a16207',
        blue: '#1d4ed8',
        magenta: '#7e22ce',
        cyan: '#0f766e',
        white: '#475569',
        brightBlack: '#64748b',
        brightRed: '#dc2626',
        brightGreen: '#16a34a',
        brightYellow: '#ca8a04',
        brightBlue: '#2563eb',
        brightMagenta: '#9333ea',
        brightCyan: '#0d9488',
        brightWhite: '#1e293b',
      }

export const XtermTerminalPane: React.FC<XtermTerminalPaneProps> = ({
  tabId,
  title,
  cwd,
  shell,
  sessionId,
  history,
  status,
  error,
  exitCode,
  theme,
  tabs,
  activeTabId,
  onInput,
  onResize,
  onRestart,
  onClear,
  onClose,
  onSelectTab,
  onCloseTab,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const writtenHistoryRef = useRef('')
  const inputHandlerRef = useRef(onInput)
  const resizeHandlerRef = useRef(onResize)
  const isWritable = status === 'open' && Boolean(sessionId)
  const terminalTheme = useMemo(() => createTerminalTheme(theme), [theme])
  const statusLabel =
    status === 'launching'
      ? 'Launching…'
      : status === 'open'
        ? 'Running'
        : status === 'error'
          ? 'Error'
          : exitCode == null
            ? 'Closed'
            : `Exited (${exitCode})`

  useEffect(() => {
    inputHandlerRef.current = onInput
  }, [onInput])

  useEffect(() => {
    resizeHandlerRef.current = onResize
  }, [onResize])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      fontFamily: 'Consolas, "Cascadia Mono", "SFMono-Regular", Menlo, Monaco, monospace',
      fontSize: 12.5,
      fontWeight: '400',
      lineHeight: 1.28,
      scrollback: 5000,
      theme: terminalTheme,
      disableStdin: !isWritable,
    })
    const fitAddon = new FitAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    terminalRef.current = term
    fitAddonRef.current = fitAddon
    writtenHistoryRef.current = ''

    const resizeToContainer = () => {
      try {
        fitAddon.fit()
        const cols = term.cols
        const rows = term.rows
        if (cols > 0 && rows > 0) {
          resizeHandlerRef.current(cols, rows)
        }
      } catch {
        // Ignore transient fit/layout errors while mounting/unmounting.
      }
    }

    const rafId = window.requestAnimationFrame(() => {
      resizeToContainer()
      term.focus()
    })

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resizeToContainer()) : null
    resizeObserver?.observe(container)
    window.addEventListener('resize', resizeToContainer)

    const disposeDataListener = term.onData(data => {
      if (isWritable) {
        inputHandlerRef.current(data)
      }
    })

    return () => {
      window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', resizeToContainer)
      disposeDataListener.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      term.dispose()
    }
  }, [isWritable, terminalTheme])

  useEffect(() => {
    const term = terminalRef.current
    if (!term) return

    term.options.theme = terminalTheme
    term.options.disableStdin = !isWritable
  }, [isWritable, terminalTheme])

  useEffect(() => {
    const term = terminalRef.current
    if (!term) return

    const previouslyWritten = writtenHistoryRef.current

    if (!history) {
      if (previouslyWritten) {
        term.reset()
        term.options.theme = terminalTheme
        term.options.disableStdin = !isWritable
        writtenHistoryRef.current = ''
      }
      return
    }

    if (!previouslyWritten || !history.startsWith(previouslyWritten)) {
      term.reset()
      term.options.theme = terminalTheme
      term.options.disableStdin = !isWritable
      term.write(history)
      writtenHistoryRef.current = history
      return
    }

    if (history.length > previouslyWritten.length) {
      term.write(history.slice(previouslyWritten.length))
      writtenHistoryRef.current = history
    }
  }, [history, isWritable, terminalTheme])

  useEffect(() => {
    if (activeTabId !== tabId) return
    const rafId = window.requestAnimationFrame(() => {
      fitAddonRef.current?.fit()
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [activeTabId, history.length, status, tabId])

  useEffect(() => {
    if (activeTabId !== tabId) return
    const rafId = window.requestAnimationFrame(() => {
      terminalRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [activeTabId, tabId])

  return (
    <section className='relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white/70 shadow-sm backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-950/60'>
      <div className='flex items-center gap-1 overflow-x-auto border-b border-neutral-200 px-2 py-2 dark:border-neutral-800'>
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId
          const tabToneClasses =
            tab.kind === 'terminal'
              ? isActive
                ? 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-100'
                : 'border-violet-200/70 bg-violet-50/80 text-violet-700 hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20'
              : tab.kind === 'diff'
                ? isActive
                  ? 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-100'
                  : 'border-sky-200/70 bg-sky-50/80 text-sky-700 hover:bg-sky-100 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20'
                : isActive
                  ? 'border-neutral-300 bg-white text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'
                  : 'border-transparent bg-neutral-100/80 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-900/60 dark:text-neutral-400 dark:hover:bg-neutral-800'

          return (
            <div
              key={tab.id}
              role='tab'
              aria-selected={isActive}
              tabIndex={0}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectTab(tab.id)
                }
              }}
              className={`group flex min-w-0 max-w-[240px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition-colors ${tabToneClasses}`}
              title={tab.title || tab.label}
            >
              <div className='flex min-w-0 flex-1 items-center gap-2 text-left'>
                <span
                  className={`h-2 w-2 flex-shrink-0 rounded-full ${
                    tab.kind === 'terminal'
                      ? 'bg-violet-500'
                      : tab.kind === 'diff'
                        ? 'bg-sky-500/80'
                        : tab.isDirty
                          ? 'bg-amber-500'
                          : 'bg-emerald-500/70'
                  }`}
                />
                <span className='truncate'>{tab.label}</span>
                {tab.kind === 'terminal' ? <span className='text-[10px] opacity-70'>Term</span> : null}
                {tab.kind === 'diff' ? <span className='text-[10px] opacity-70'>Diff</span> : null}
                {tab.isSaving ? <span className='text-[10px] opacity-70'>Saving…</span> : null}
              </div>
              <button
                type='button'
                onClick={event => {
                  event.stopPropagation()
                  onCloseTab(tab.id)
                }}
                className='rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-100'
                aria-label={`Close ${tab.label}`}
                title='Close tab'
              >
                <i className='bx bx-x text-sm' />
              </button>
            </div>
          )
        })}
      </div>

      <header className='flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800'>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <strong className='truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100'>{title}</strong>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                status === 'open'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
                  : status === 'error'
                    ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200'
                    : 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200'
              }`}
            >
              {statusLabel}
            </span>
          </div>
          <div className='mt-0.5 flex items-center gap-2 truncate text-[11px] text-neutral-500 dark:text-neutral-400'>
            <span className='truncate' title={cwd}>
              {cwd || 'No working directory'}
            </span>
            <span aria-hidden='true'>•</span>
            <span>{shell || 'shell'}</span>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <Button variant='outline2' size='small' onClick={onRestart}>
            Restart
          </Button>
          <Button variant='outline2' size='small' onClick={onClear} disabled={history.length === 0}>
            Clear
          </Button>
          <Button variant='outline2' size='small' onClick={onClose} aria-label='Close terminal'>
            Close
          </Button>
        </div>
      </header>

      {error ? (
        <div className='border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200'>
          {error}
        </div>
      ) : null}

      <div className={`relative min-h-0 flex-1 ${theme === 'vs-dark' ? 'bg-[#0a0a0a]' : 'bg-[#f8fafc]'}`}>
        <div ref={containerRef} className='h-full w-full px-2 py-2' />

        {status !== 'open' ? (
          <div className='pointer-events-none absolute right-4 top-4 rounded-full border border-neutral-200/80 bg-white/85 px-3 py-1 text-[11px] font-medium text-neutral-600 shadow-sm backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/80 dark:text-neutral-200'>
            {status === 'launching'
              ? 'Starting shell…'
              : status === 'error'
                ? 'Terminal unavailable'
                : exitCode == null
                  ? 'Session closed'
                  : `Exited with code ${exitCode}`}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default XtermTerminalPane
