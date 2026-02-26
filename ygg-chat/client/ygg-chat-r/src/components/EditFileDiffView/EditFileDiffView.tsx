import * as Diff from 'diff'
import React, { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'

export interface EditFileArgs {
  path?: string
  operation?: string
  searchPattern?: string
  replacement?: string
  content?: string // For append operation
  validateContent?: boolean
}

export interface EditFileLineInfo {
  oldStartLine: number
  oldEndLine: number
  oldLineCount: number
  newStartLine: number
  newEndLine: number
  newLineCount: number
  scope?: 'single' | 'first_of_many' | 'append'
}

export interface EditFileResult {
  success?: boolean
  sizeBytes?: number
  replacements?: number
  message?: string
  matchStrategy?: string
  attemptedStrategies?: string[]
  lineInfo?: EditFileLineInfo
}

interface EditFileDiffViewProps {
  args: EditFileArgs
  result: EditFileResult | string
  className?: string
}

type ViewMode = 'unified' | 'split' | 'inline'

function getLanguageFromPath(filePath: string): string {
  if (!filePath) return 'plaintext'
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    sql: 'sql',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    toml: 'toml',
    ini: 'ini',
    conf: 'ini',
    dockerfile: 'dockerfile',
    vue: 'vue',
    svelte: 'svelte',
  }
  return langMap[ext] || 'plaintext'
}

function parseResult(result: EditFileResult | string): EditFileResult {
  if (typeof result === 'string') {
    try {
      return JSON.parse(result)
    } catch {
      return { message: result }
    }
  }
  return result
}

function getFilename(path: string): string {
  if (!path) return 'unknown'
  return path.split('/').pop() || path
}

interface InlineDiffLineProps {
  type: 'added' | 'removed' | 'unchanged'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

const InlineDiffLine: React.FC<InlineDiffLineProps> = ({ type, content, oldLineNumber, newLineNumber }) => {
  const bgClass =
    type === 'added'
      ? 'bg-emerald-100 dark:bg-emerald-500/15'
      : type === 'removed'
        ? 'bg-red-100 dark:bg-red-500/15'
        : 'bg-transparent'

  const textClass =
    type === 'added'
      ? 'text-emerald-800 dark:text-emerald-300'
      : type === 'removed'
        ? 'text-red-800 dark:text-red-300 line-through'
        : 'text-neutral-700 dark:text-neutral-300'

  const prefixIcon =
    type === 'added' ? (
      <span className='text-emerald-600 dark:text-emerald-400 select-none'>+</span>
    ) : type === 'removed' ? (
      <span className='text-red-600 dark:text-red-400 select-none'>−</span>
    ) : (
      <span className='text-neutral-400 dark:text-neutral-600 select-none'> </span>
    )

  const lineCellClass =
    'w-10 flex-shrink-0 text-right pr-2 text-neutral-400 dark:text-neutral-600 select-none border-r border-neutral-200 dark:border-neutral-700'

  return (
    <div className={`flex ${bgClass} font-mono text-[10px] leading-snug`}>
      <span className={lineCellClass}>{oldLineNumber ?? ''}</span>
      <span className={lineCellClass}>{newLineNumber ?? ''}</span>
      <span className='w-4 flex-shrink-0 text-center'>{prefixIcon}</span>
      <span className={`flex-1 whitespace-pre-wrap break-all ${textClass}`}>{content || ' '}</span>
    </div>
  )
}

interface InlineDiffViewProps {
  original: string
  replacement: string
  lineInfo?: EditFileLineInfo
}

const InlineDiffView: React.FC<InlineDiffViewProps> = ({ original, replacement, lineInfo }) => {
  const diffLines = useMemo(() => {
    const changes = Diff.diffLines(original || '', replacement || '')

    const lines: Array<{
      type: 'added' | 'removed' | 'unchanged'
      content: string
      oldLineNumber?: number
      newLineNumber?: number
    }> = []

    let oldLineNumber = lineInfo?.oldStartLine ?? 1
    let newLineNumber = lineInfo?.newStartLine ?? 1

    changes.forEach(change => {
      const changeLines = change.value.split('\n')
      if (changeLines[changeLines.length - 1] === '') {
        changeLines.pop()
      }

      changeLines.forEach(line => {
        if (change.added) {
          lines.push({ type: 'added', content: line, newLineNumber })
          newLineNumber += 1
        } else if (change.removed) {
          lines.push({ type: 'removed', content: line, oldLineNumber })
          oldLineNumber += 1
        } else {
          lines.push({ type: 'unchanged', content: line, oldLineNumber, newLineNumber })
          oldLineNumber += 1
          newLineNumber += 1
        }
      })
    })

    return lines
  }, [original, replacement, lineInfo])

  return (
    <div className='overflow-x-auto max-h-[300px] overflow-y-auto'>
      <div className='sticky top-0 z-10 flex font-mono text-[9px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700'>
        <span className='w-10 flex-shrink-0 text-right pr-2 border-r border-neutral-200 dark:border-neutral-700'>old</span>
        <span className='w-10 flex-shrink-0 text-right pr-2 border-r border-neutral-200 dark:border-neutral-700'>new</span>
        <span className='w-4 flex-shrink-0 text-center'>±</span>
        <span className='flex-1 pl-1'>code</span>
      </div>
      {diffLines.map((line, idx) => (
        <InlineDiffLine
          key={idx}
          type={line.type}
          content={line.content}
          oldLineNumber={line.oldLineNumber}
          newLineNumber={line.newLineNumber}
        />
      ))}
    </div>
  )
}

export const EditFileDiffView: React.FC<EditFileDiffViewProps> = ({ args, result, className = '' }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('inline')

  const parsedResult = useMemo(() => parseResult(result), [result])
  const language = useMemo(() => getLanguageFromPath(args.path || ''), [args.path])
  const filename = useMemo(() => getFilename(args.path || ''), [args.path])

  const isSuccess = parsedResult.success === true
  const hasChanges = (parsedResult.replacements ?? 0) > 0
  const isAppendOperation = (args.operation ?? '').toLowerCase() === 'append'
  const lineInfo = parsedResult.lineInfo

  const originalMarkdown = useMemo(() => {
    return `\`\`\`${language}\n${args.searchPattern || ''}\n\`\`\``
  }, [args.searchPattern, language])

  const replacementMarkdown = useMemo(() => {
    return `\`\`\`${language}\n${args.replacement || ''}\n\`\`\``
  }, [args.replacement, language])

  const codeBlockStyles =
    '[&_pre]:!m-0 [&_pre]:!p-2 [&_pre]:!bg-transparent [&_pre]:!border-0 [&_code]:!text-[10px] [&_code]:!leading-snug [&_code]:!font-mono [&_code]:!bg-transparent [&_.hljs]:!bg-transparent [&_pre_code]:!p-0'

  return (
    <div className={`rounded-md bg-white dark:bg-neutral-900 overflow-hidden ${className}`}>
      <div className='flex items-center justify-between gap-2 px-2 py-0 bg-neutral-100 dark:bg-neutral-900/80'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <span className='text-[9px] font-bold uppercase tracking-wide rounded text-blue-600 dark:text-blue-400'>
            {args.operation || 'replace'}
          </span>

          <span
            className='flex min-w-0 items-center gap-1 text-[10px] font-mono overflow-left text-neutral-600 dark:text-neutral-500'
            title={args.path}
          >
            <span className='block min-w-0 max-w-[150px] sm:max-w-[250px] md:max-w-[350px] lg:max-w-[600px] truncate'>
              {filename}
            </span>
          </span>
        </div>

        <div className='flex shrink-0 items-center gap-1'>
          {hasChanges && (
            <span className='px-1.5 py-0.5 text-[9px] ml-1 font-medium rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'>
              {parsedResult.replacements}
            </span>
          )}

          {lineInfo && (
            <span
              className='px-1.5 py-0.5 text-[9px] font-medium rounded bg-blue-500/10 text-blue-600 dark:text-blue-400'
              title='Real file line anchors (old/new)'
            >
              L{lineInfo.oldStartLine} → L{lineInfo.newStartLine}
            </span>
          )}

          {lineInfo?.scope === 'first_of_many' && (
            <span className='px-1.5 py-0.5 text-[8px] uppercase rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'>
              first hunk
            </span>
          )}

          {!isAppendOperation && (
            <div className='flex items-center rounded bg-neutral-200 dark:bg-neutral-700/50 p-0.5'>
              <button
                className={`px-1 py-0.5 rounded text-[10px] transition-all ${viewMode === 'inline' ? 'bg-white dark:bg-neutral-600 text-neutral-800 dark:text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
                onClick={() => setViewMode('inline')}
                title='Inline diff (git-style merged)'
              >
                <i className='bx bx-git-compare' />
              </button>
              <button
                className={`px-1 py-0.5 rounded text-[10px] transition-all ${viewMode === 'unified' ? 'bg-white dark:bg-neutral-600 text-neutral-800 dark:text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
                onClick={() => setViewMode('unified')}
                title='Unified view (stacked)'
              >
                <i className='bx bx-align-left' />
              </button>
              <button
                className={`px-1 py-0.5 rounded text-[10px] transition-all ${viewMode === 'split' ? 'bg-white dark:bg-neutral-600 text-neutral-800 dark:text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
                onClick={() => setViewMode('split')}
                title='Split view (side-by-side)'
              >
                <i className='bx bx-columns' />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className='p-1'>
        {isAppendOperation ? (
          <div className='rounded overflow-hidden pb-1'>
            <div className='bg-neutral-50 dark:bg-neutral-900'>
              <InlineDiffView original='' replacement={args.content || ''} lineInfo={lineInfo} />
            </div>
          </div>
        ) : viewMode === 'inline' ? (
          <div className='rounded overflow-hidden pb-1'>
            <div className='bg-neutral-50 dark:bg-neutral-900'>
              <InlineDiffView original={args.searchPattern || ''} replacement={args.replacement || ''} lineInfo={lineInfo} />
            </div>
          </div>
        ) : viewMode === 'unified' ? (
          <div className='space-y-1'>
            <div className='rounded overflow-hidden'>
              <div className='flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/20'>
                <i className='bx bx-minus text-[10px] text-red-600 dark:text-red-400' />
              </div>
              <div className={`bg-red-50 dark:bg-red-500/5 ${codeBlockStyles} overflow-x-auto`}>
                <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>{originalMarkdown}</ReactMarkdown>
              </div>
            </div>

            <div className='rounded overflow-hidden'>
              <div className='flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/10 border-b border-emerald-200 dark:border-emerald-500/20'>
                <i className='bx bx-plus text-[10px] text-emerald-600 dark:text-emerald-400' />
              </div>
              <div className={`bg-emerald-50 dark:bg-emerald-500/5 ${codeBlockStyles} overflow-x-auto`}>
                <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>{replacementMarkdown}</ReactMarkdown>
              </div>
            </div>
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-1'>
            <div className='rounded overflow-hidden'>
              <div className='flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/20'>
                <i className='bx bx-minus text-[10px] text-red-600 dark:text-red-400' />
                <span className='text-[9px] font-medium text-red-700 dark:text-red-400/80'>Original</span>
              </div>
              <div className={`bg-red-50 dark:bg-red-500/5 ${codeBlockStyles} overflow-x-auto max-h-[250px] overflow-y-auto`}>
                <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>{originalMarkdown}</ReactMarkdown>
              </div>
            </div>

            <div className='rounded overflow-hidden'>
              <div className='flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/10 border-b border-emerald-200 dark:border-emerald-500/20'>
                <i className='bx bx-plus text-[10px] text-emerald-600 dark:text-emerald-400' />
                <span className='text-[9px] font-medium text-emerald-700 dark:text-emerald-400/80'>Replacement</span>
              </div>
              <div className={`bg-emerald-50 dark:bg-emerald-500/5 ${codeBlockStyles} overflow-x-auto max-h-[250px] overflow-y-auto`}>
                <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>{replacementMarkdown}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}
      </div>

      {parsedResult.message && (
        <div
          className={`flex items-center gap-1.5 px-2 py-1 text-[9px] border-t font-mono ${
            isSuccess
              ? 'bg-emerald-50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400/90'
              : 'bg-red-50 dark:bg-red-500/5 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400/90'
          }`}
        >
          <i className={`bx ${isSuccess ? 'bx-check' : 'bx-x'} text-xs`} />
          <span className='flex-1 truncate'>{parsedResult.message}</span>
          {parsedResult.matchStrategy && parsedResult.matchStrategy !== 'exact' && (
            <span className='px-1 py-0.5 text-[8px] uppercase rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'>
              {parsedResult.matchStrategy}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default EditFileDiffView
