import React, { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import * as Diff from 'diff'

export interface EditFileArgs {
    path?: string
    operation?: string
    searchPattern?: string
    replacement?: string
    content?: string // For append operation
    validateContent?: boolean
}

export interface EditFileResult {
    success?: boolean
    sizeBytes?: number
    replacements?: number
    message?: string
    matchStrategy?: string
    attemptedStrategies?: string[]
}

interface EditFileDiffViewProps {
    args: EditFileArgs
    result: EditFileResult | string
    className?: string
}

type ViewMode = 'unified' | 'split' | 'inline'

/**
 * Attempts to detect the language/extension from a file path
 */
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

/**
 * Parse result which could be a JSON string or already an object
 */
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

/**
 * Get a short filename from a full path
 */
function getFilename(path: string): string {
    if (!path) return 'unknown'
    return path.split('/').pop() || path
}

/**
 * Inline Diff Line Component - renders a single line with word-level diff highlighting
 */
interface InlineDiffLineProps {
    type: 'added' | 'removed' | 'unchanged'
    content: string
    lineNumber?: number
}

const InlineDiffLine: React.FC<InlineDiffLineProps> = ({ type, content, lineNumber }) => {
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

    return (
        <div className={`flex ${bgClass} font-mono text-[10px] leading-snug`}>
            {lineNumber !== undefined && (
                <span className='w-8 flex-shrink-0 text-right pr-2 text-neutral-400 dark:text-neutral-600 select-none border-r border-neutral-200 dark:border-neutral-700'>
                    {lineNumber}
                </span>
            )}
            <span className='w-4 flex-shrink-0 text-center'>{prefixIcon}</span>
            <span className={`flex-1 whitespace-pre-wrap break-all ${textClass}`}>{content || ' '}</span>
        </div>
    )
}

/**
 * Inline Diff View - renders a merged view with line-by-line diff
 */
interface InlineDiffViewProps {
    original: string
    replacement: string
}

const InlineDiffView: React.FC<InlineDiffViewProps> = ({ original, replacement }) => {
    const diffLines = useMemo(() => {
        // Use line-by-line diff
        const changes = Diff.diffLines(original || '', replacement || '')

        const lines: Array<{ type: 'added' | 'removed' | 'unchanged'; content: string; lineNum?: number }> = []
        let lineNum = 1

        changes.forEach((change) => {
            const changeLines = change.value.split('\n')
            // Remove empty last element if the string ends with newline
            if (changeLines[changeLines.length - 1] === '') {
                changeLines.pop()
            }

            changeLines.forEach((line) => {
                if (change.added) {
                    lines.push({ type: 'added', content: line, lineNum: lineNum++ })
                } else if (change.removed) {
                    lines.push({ type: 'removed', content: line })
                } else {
                    lines.push({ type: 'unchanged', content: line, lineNum: lineNum++ })
                }
            })
        })

        return lines
    }, [original, replacement])

    return (
        <div className='overflow-x-auto max-h-[300px] overflow-y-auto'>
            {diffLines.map((line, idx) => (
                <InlineDiffLine key={idx} type={line.type} content={line.content} lineNumber={line.lineNum} />
            ))}
        </div>
    )
}

/**
 * EditFileDiffView - A stylish diff viewer component for edit_file tool results
 *
 * Displays the search pattern and replacement in a unified diff-like view
 * with syntax highlighting based on the file extension.
 */
export const EditFileDiffView: React.FC<EditFileDiffViewProps> = ({ args, result, className = '' }) => {
    const [viewMode, setViewMode] = useState<ViewMode>('unified')
    const [isExpanded, setIsExpanded] = useState(true)

    const parsedResult = useMemo(() => parseResult(result), [result])
    const language = useMemo(() => getLanguageFromPath(args.path || ''), [args.path])
    const filename = useMemo(() => getFilename(args.path || ''), [args.path])

    const isSuccess = parsedResult.success === true
    const hasChanges = (parsedResult.replacements ?? 0) > 0
    const isAppendOperation = (args.operation ?? '').toLowerCase() === 'append'

    // Generate the markdown code blocks for ReactMarkdown
    const originalMarkdown = useMemo(() => {
        return `\`\`\`${language}\n${args.searchPattern || ''}\n\`\`\``
    }, [args.searchPattern, language])

    const replacementMarkdown = useMemo(() => {
        return `\`\`\`${language}\n${args.replacement || ''}\n\`\`\``
    }, [args.replacement, language])

    // For append operation, use the content field
    const appendContentMarkdown = useMemo(() => {
        return `\`\`\`${language}\n${args.content || ''}\n\`\`\``
    }, [args.content, language])

    // Shared code block styling - transparent bg so parent colors show through
    const codeBlockStyles =
        '[&_pre]:!m-0 [&_pre]:!p-2 [&_pre]:!bg-transparent [&_pre]:!border-0 [&_code]:!text-[10px] [&_code]:!leading-snug [&_code]:!font-mono [&_code]:!bg-transparent [&_.hljs]:!bg-transparent [&_pre_code]:!p-0'

    return (
        <div
            className={`rounded-md border border-neutral-300 dark:border-neutral-700/60 bg-white dark:bg-neutral-900 overflow-hidden ${className}`}
        >
            {/* Header bar */}
            <div className='flex items-center justify-between px-2 py-0 bg-neutral-100 dark:bg-neutral-800/80 border-b border-neutral-300 dark:border-neutral-700/60'>
                <div className='flex items-center gap-2'>
                    {/* Status indicator */}
                    <div
                        className={`w-1.5 h-1.5 rounded-full ${isSuccess ? 'bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]' : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]'}`}
                    />

                    {/* Operation badge */}
                    <span className='px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide rounded bg-blue-500/20 text-blue-600 dark:text-blue-400'>
                        {args.operation || 'replace'}
                    </span>

                    {/* File path */}
                    <span
                        className='flex items-center gap-1 text-[10px] font-mono text-neutral-600 dark:text-neutral-500'
                        title={args.path}
                    >
                        <span className='max-w-[150px] truncate'>{filename}</span>
                    </span>
                </div>

                <div className='flex items-center gap-1'>
                    {/* Changes badge */}
                    {hasChanges && (
                        <span className='px-1.5 py-0.5 text-[9px] font-medium rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'>
                            {parsedResult.replacements}
                        </span>
                    )}

                    {/* View mode toggle - 3 modes now */}
                    {!isAppendOperation && (
                        <div className='flex items-center rounded bg-neutral-200 dark:bg-neutral-700/50 p-0.5'>
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
                            <button
                                className={`px-1 py-0.5 rounded text-[10px] transition-all ${viewMode === 'inline' ? 'bg-white dark:bg-neutral-600 text-neutral-800 dark:text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}
                                onClick={() => setViewMode('inline')}
                                title='Inline diff (git-style merged)'
                            >
                                <i className='bx bx-git-compare' />
                            </button>
                        </div>
                    )}

                    {/* Collapse button */}
                    <button
                        className='px-1 py-0.5 rounded text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-300 transition-all'
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        <i className={`bx ${isExpanded ? 'bx-chevron-up' : 'bx-chevron-down'} text-xs`} />
                    </button>
                </div>
            </div>

            {/* Collapsed view - show only new content */}
            {!isExpanded && (
                <div className='p-1'>
                    <div className='rounded overflow-hidden'>
                        <div className='flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/10 border-b border-emerald-200 dark:border-emerald-500/20'>
                            <i className='bx bx-plus text-[10px] text-emerald-600 dark:text-emerald-400' />
                        </div>
                        <div
                            className={`bg-emerald-50 dark:bg-emerald-500/5 ${codeBlockStyles} overflow-x-auto max-h-[150px] overflow-y-auto`}
                        >
                            <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>
                                {isAppendOperation ? appendContentMarkdown : replacementMarkdown}
                            </ReactMarkdown>
                        </div>
                    </div>
                </div>
            )}

            {/* Diff content - full view when expanded */}
            {isExpanded && (
                <div className='p-1'>
                    {isAppendOperation ? (
                        /* Append operation - single content block */
                        <div className='rounded overflow-hidden'>
                            <div className='flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/10 border-b border-emerald-200 dark:border-emerald-500/20'>
                                <i className='bx bx-plus text-[10px] text-emerald-600 dark:text-emerald-400' />
                            </div>
                            <div
                                className={`bg-emerald-50 dark:bg-emerald-500/5 ${codeBlockStyles} overflow-x-auto max-h-[300px] overflow-y-auto`}
                            >
                                <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>
                                    {appendContentMarkdown}
                                </ReactMarkdown>
                            </div>
                        </div>
                    ) : viewMode === 'inline' ? (
                        /* Inline diff mode - git-style merged view */
                        <div className='rounded overflow-hidden border border-neutral-200 dark:border-neutral-700'>
                            <div className='flex items-center gap-1.5 px-2 py-0.5 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700'>
                                <i className='bx bx-git-compare text-[10px] text-neutral-500 dark:text-neutral-400' />
                                <span className='text-[9px] font-medium text-neutral-600 dark:text-neutral-400'>Inline Diff</span>
                            </div>
                            <div className='bg-neutral-50 dark:bg-neutral-900'>
                                <InlineDiffView original={args.searchPattern || ''} replacement={args.replacement || ''} />
                            </div>
                        </div>
                    ) : viewMode === 'unified' ? (
                        <div className='space-y-1'>
                            {/* Original */}
                            <div className='rounded overflow-hidden'>
                                <div className='flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/20'>
                                    <i className='bx bx-minus text-[10px] text-red-600 dark:text-red-400' />
                                </div>
                                <div className={`bg-red-50 dark:bg-red-500/5 ${codeBlockStyles} overflow-x-auto`}>
                                    <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>
                                        {originalMarkdown}
                                    </ReactMarkdown>
                                </div>
                            </div>

                            {/* Replacement */}
                            <div className='rounded overflow-hidden'>
                                <div className='flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/10 border-b border-emerald-200 dark:border-emerald-500/20'>
                                    <i className='bx bx-plus text-[10px] text-emerald-600 dark:text-emerald-400' />
                                </div>
                                <div className={`bg-emerald-50 dark:bg-emerald-500/5 ${codeBlockStyles} overflow-x-auto`}>
                                    <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>
                                        {replacementMarkdown}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className='grid grid-cols-2 gap-1'>
                            {/* Left - Original */}
                            <div className='rounded overflow-hidden'>
                                <div className='flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-500/10 border-b border-red-200 dark:border-red-500/20'>
                                    <i className='bx bx-minus text-[10px] text-red-600 dark:text-red-400' />
                                    <span className='text-[9px] font-medium text-red-700 dark:text-red-400/80'>Original</span>
                                </div>
                                <div
                                    className={`bg-red-50 dark:bg-red-500/5 ${codeBlockStyles} overflow-x-auto max-h-[250px] overflow-y-auto`}
                                >
                                    <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>
                                        {originalMarkdown}
                                    </ReactMarkdown>
                                </div>
                            </div>

                            {/* Right - Replacement */}
                            <div className='rounded overflow-hidden'>
                                <div className='flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/10 border-b border-emerald-200 dark:border-emerald-500/20'>
                                    <i className='bx bx-plus text-[10px] text-emerald-600 dark:text-emerald-400' />
                                    <span className='text-[9px] font-medium text-emerald-700 dark:text-emerald-400/80'>Replacement</span>
                                </div>
                                <div
                                    className={`bg-emerald-50 dark:bg-emerald-500/5 ${codeBlockStyles} overflow-x-auto max-h-[250px] overflow-y-auto`}
                                >
                                    <ReactMarkdown rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}>
                                        {replacementMarkdown}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Result message footer */}
            {parsedResult.message && (
                <div
                    className={`flex items-center gap-1.5 px-2 py-1 text-[9px] border-t font-mono ${isSuccess
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
