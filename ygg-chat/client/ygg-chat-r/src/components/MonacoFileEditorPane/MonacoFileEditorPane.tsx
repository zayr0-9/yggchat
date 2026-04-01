import React, { useEffect, useMemo, useRef } from 'react'
import Editor from '@monaco-editor/react'
import type * as MonacoEditor from 'monaco-editor'
import { Button } from '../Button/button'

export interface MonacoPaneTabItem {
  id: string
  label: string
  title?: string
  kind?: 'file' | 'diff' | 'terminal'
  isDirty: boolean
  isSaving: boolean
}

interface MonacoFileEditorPaneProps {
  filePath: string | null
  value: string
  loading: boolean
  error: string | null
  isDirty: boolean
  isSaving: boolean
  theme: 'vs' | 'vs-dark'
  tabs: MonacoPaneTabItem[]
  activeTabId: string | null
  onChange: (nextValue: string) => void
  onSave: () => void
  onClose: () => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
}

const extensionLanguageMap: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  json: 'json',
  md: 'markdown',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'cpp',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  txt: 'plaintext',
}

const detectLanguage = (filePath: string | null): string => {
  if (!filePath) return 'plaintext'
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1 || dotIndex === filePath.length - 1) return 'plaintext'
  const extension = filePath.slice(dotIndex + 1).toLowerCase()
  return extensionLanguageMap[extension] || 'plaintext'
}

export const MonacoFileEditorPane: React.FC<MonacoFileEditorPaneProps> = ({
  filePath,
  value,
  loading,
  error,
  isDirty,
  isSaving,
  theme,
  tabs,
  activeTabId,
  onChange,
  onSave,
  onClose,
  onSelectTab,
  onCloseTab,
}) => {
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null)
  const saveStateRef = useRef({ loading, isSaving, isDirty, onSave })
  const language = useMemo(() => detectLanguage(filePath), [filePath])

  useEffect(() => {
    saveStateRef.current = { loading, isSaving, isDirty, onSave }
  }, [isDirty, isSaving, loading, onSave])

  useEffect(() => {
    const rafId = window.requestAnimationFrame(() => {
      editorRef.current?.layout()
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [filePath, loading, theme])

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
              className={`group flex min-w-0 max-w-[220px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition-colors ${tabToneClasses}`}
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
            <strong className='truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100'>
              {filePath || 'File editor'}
            </strong>
            {isDirty ? (
              <span className='h-2.5 w-2.5 flex-shrink-0 rounded-full bg-amber-500' title='Unsaved changes' />
            ) : null}
          </div>
          <div className='mt-0.5 flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400'>
            <span>{language}</span>
            <span aria-hidden='true'>•</span>
            <span>{isDirty ? 'Unsaved changes' : 'Saved'}</span>
          </div>
        </div>

        <div className='flex items-center gap-2'>
          <Button
            variant='outline2'
            size='small'
            onClick={onSave}
            disabled={!filePath || loading || isSaving || !isDirty}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
          <Button variant='outline2' size='small' onClick={onClose} aria-label='Close editor'>
            Close
          </Button>
        </div>
      </header>

      {error ? (
        <div className='border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200'>
          {error}
        </div>
      ) : null}

      <div className={`relative min-h-0 flex-1 ${theme === 'vs-dark' ? 'bg-[#1e1e1e]' : 'bg-[#ffffff]'}`}>
        <Editor
          path={filePath ?? undefined}
          theme={theme}
          language={language}
          value={value}
          width='100%'
          height='100%'
          onMount={(editor, monaco) => {
            editorRef.current = editor
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              const currentSaveState = saveStateRef.current
              if (!currentSaveState.loading && !currentSaveState.isSaving && currentSaveState.isDirty) {
                currentSaveState.onSave()
              }
            })
            window.requestAnimationFrame(() => editor.layout())
          }}
          onChange={next => onChange(next ?? '')}
          options={{
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: 'on',
            smoothScrolling: true,
            scrollBeyondLastLine: false,
            tabSize: 2,
          }}
        />

        {loading ? (
          <div
            className={`absolute inset-0 flex items-center justify-center text-sm backdrop-blur-[1px] ${
              theme === 'vs-dark' ? 'bg-neutral-950/35 text-white' : 'bg-white/70 text-neutral-700'
            }`}
          >
            Loading file…
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default MonacoFileEditorPane
