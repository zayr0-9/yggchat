import { useQueryClient } from '@tanstack/react-query'
import mammoth from 'mammoth'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { selectCurrentConversationId } from '../../features/chats'
import { convContextSet, systemPromptSet, updateContext, updateSystemPrompt } from '../../features/conversations'
import type { Conversation } from '../../features/conversations/conversationTypes'
import { selectSelectedProject } from '../../features/projects'
import { useAppDispatch, useAppSelector } from '../../hooks/redux'
import { extractTextFromPdf } from '../../utils/pdfUtils'
import { InputTextArea } from '../InputTextArea/InputTextArea'
import { ToolsSettings } from './ToolsSettings'

type SettingsPaneProps = {
  open: boolean
  onClose: () => void
}

const TEXT_FILE_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.go',
  '.rs',
  '.kt',
  '.kts',
  '.sh',
  '.bash',
  '.zsh',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.sql',
  '.rb',
  '.php',
  '.swift',
  '.gradle',
  '.bat',
  '.ps1',
  '.scala',
  '.erl',
  '.ex',
  '.r',
  '.csv',
  '.log',
]

const isPdfFile = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

const isSupportedTextFile = (file: File) => {
  if (file.type.startsWith('text/')) {
    return true
  }
  const lowerName = file.name.toLowerCase()
  return TEXT_FILE_EXTENSIONS.some(ext => lowerName.endsWith(ext))
}

const isDocxFile = (file: File) =>
  file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
  file.name.toLowerCase().endsWith('.docx')

const extractTextFromDocx = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer()
  const { value: text } = await mammoth.extractRawText({ arrayBuffer })
  return text.trim()
}

export const SettingsPane: React.FC<SettingsPaneProps> = ({ open, onClose }) => {
  const dispatch = useAppDispatch()
  const queryClient = useQueryClient()
  const systemPrompt = useAppSelector(state => state.conversations.systemPrompt ?? '')
  const context = useAppSelector(state => state.conversations.convContext ?? '')
  const conversationId = useAppSelector(selectCurrentConversationId)
  const selectedProject = useAppSelector(selectSelectedProject)
  const conversations = useAppSelector(state => state.conversations.items)
  const tools = useAppSelector(state => state.chat.tools ?? [])

  const [attachmentTarget, setAttachmentTarget] = useState<'system' | 'context'>('system')
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  // Track initial values when modal opens to detect changes
  const initialSystemPromptRef = useRef<string | null>(null)
  const initialContextRef = useRef<string | null>(null)
  const prevOpenRef = useRef<boolean>(false)

  const handleChange = useCallback(
    (value: string) => {
      // Only update Redux state for instant UI feedback
      dispatch(systemPromptSet(value))
    },
    [dispatch]
  )

  const handleContextChange = useCallback(
    (value: string) => {
      // Only update Redux state for instant UI feedback
      dispatch(convContextSet(value))
    },
    [dispatch]
  )

  const handleAttachmentInputChange = useCallback(
    (target: 'system' | 'context') => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length === 0) return

      const pdfFiles = files.filter(isPdfFile)
      const docxFiles = files.filter(isDocxFile)
      const textFiles = files.filter(file => !isPdfFile(file) && !isDocxFile(file) && isSupportedTextFile(file))
      if (pdfFiles.length === 0 && docxFiles.length === 0 && textFiles.length === 0) {
        e.target.value = ''
        return
      }

      const collected: string[] = []

      if (pdfFiles.length > 0) {
        try {
          const pdfTexts = await Promise.all(
            pdfFiles.map(
              async file => `[Pdf Content for ${file.name}]:
${await extractTextFromPdf(file)}`
            )
          )
          collected.push(...pdfTexts)
        } catch (err) {
          console.error('Failed to extract PDF text(s)', err)
        }
      }

      if (textFiles.length > 0) {
        const textBlocks = await Promise.all(
          textFiles.map(async file => {
            try {
              const text = await file.text()
              return `[Text Content for ${file.name}]:
${text}`
            } catch (err) {
              console.error(`Failed to read text file ${file.name}`, err)
              return null
            }
          })
        )
        collected.push(...textBlocks.filter((block): block is string => Boolean(block)))
      }

      if (docxFiles.length > 0) {
        const docxBlocks = await Promise.all(
          docxFiles.map(async file => {
            try {
              const text = await extractTextFromDocx(file)
              return `[Docx Content for ${file.name}]:
${text}`
            } catch (err) {
              console.error(`Failed to extract DOCX text for ${file.name}`, err)
              return null
            }
          })
        )
        collected.push(...docxBlocks.filter((block): block is string => Boolean(block)))
      }

      if (collected.length === 0) {
        e.target.value = ''
        return
      }

      const block = `\`\`\`
${collected.join('')}
\`\`\`

`

      if (target === 'system') {
        const next = systemPrompt
          ? `${systemPrompt}

${block}`
          : block
        dispatch(systemPromptSet(next))
      } else {
        const next = context
          ? `${context}

${block}`
          : block
        dispatch(convContextSet(next))
      }

      e.target.value = ''
    },
    [context, dispatch, systemPrompt]
  )

  // Capture initial values when modal opens and save changes when it closes
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      initialSystemPromptRef.current = systemPrompt
      initialContextRef.current = context
    }

    if (!open && prevOpenRef.current) {
      if (conversationId) {
        const currentSystemPrompt = systemPrompt.trim() === '' ? null : systemPrompt
        const currentContext = context.trim() === '' ? null : context
        const initialSystemPrompt =
          initialSystemPromptRef.current?.trim() === '' ? null : initialSystemPromptRef.current
        const initialContext = initialContextRef.current?.trim() === '' ? null : initialContextRef.current

        const systemPromptChanged = currentSystemPrompt !== initialSystemPrompt
        const contextChanged = currentContext !== initialContext

        const currentConversation = conversations.find(conv => conv.id === conversationId) || null
        const projectId = currentConversation?.project_id || selectedProject?.id || null

        const updateSystemPromptInCache = (items: Conversation[] | undefined) => {
          if (!items) return items
          return items.map(conv =>
            conv.id === conversationId ? { ...conv, system_prompt: currentSystemPrompt } : conv
          )
        }

        const updateContextInCache = (items: Conversation[] | undefined) => {
          if (!items) return items
          return items.map(conv =>
            conv.id === conversationId ? { ...conv, conversation_context: currentContext } : conv
          )
        }

        if (systemPromptChanged) {
          dispatch(updateSystemPrompt({ id: conversationId, systemPrompt: currentSystemPrompt }))
            .unwrap()
            .then(() => {
              queryClient.setQueryData<Conversation[]>(['conversations'], updateSystemPromptInCache)
              if (projectId) {
                queryClient.setQueryData<Conversation[]>(
                  ['conversations', 'project', projectId],
                  updateSystemPromptInCache
                )
              }
              queryClient.setQueryData<Conversation[]>(['conversations', 'recent'], updateSystemPromptInCache)
              queryClient.setQueryData(['conversations', conversationId, 'data'], (prev: any) =>
                prev ? { ...prev, systemPrompt: currentSystemPrompt } : prev
              )
            })
            .catch(error => {
              console.error('Failed to update system prompt:', error)
            })
        }

        if (contextChanged) {
          dispatch(updateContext({ id: conversationId, context: currentContext }))
            .unwrap()
            .then(() => {
              queryClient.setQueryData<Conversation[]>(['conversations'], updateContextInCache)
              if (projectId) {
                queryClient.setQueryData<Conversation[]>(['conversations', 'project', projectId], updateContextInCache)
              }
              queryClient.setQueryData<Conversation[]>(['conversations', 'recent'], updateContextInCache)
              queryClient.setQueryData(['conversations', conversationId, 'data'], (prev: any) =>
                prev ? { ...prev, context: currentContext } : prev
              )
            })
            .catch(error => {
              console.error('Failed to update context:', error)
            })
        }
      }

      initialSystemPromptRef.current = null
      initialContextRef.current = null
    }

    prevOpenRef.current = open
  }, [open, conversationId, systemPrompt, context, conversations, dispatch, queryClient, selectedProject])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className='fixed inset-0 z-40 flex items-center justify-center'>
      {/* Overlay */}
      <div
        className='fixed inset-0 bg-neutral-300/50 dark:bg-neutral-900/20 bg-opacity-50 backdrop-blur-sm'
        onClick={onClose}
      />

      {/* Modal */}
      <div className='py-2 w-5xl'>
        <div
          className={`relative z-50 mx-4 rounded-3xl px-12 py-4 lg:py-6 dark:border-1 dark:border-neutral-900 bg-neutral-100 dark:bg-yBlack-900 shadow-lg overflow-y-scroll no-scrollbar transition-all duration-300 ease-in-out ${
            tools.some(tool => tool.enabled) ? 'h-[80vh]' : 'h-[58vh]'
          }`}
          onClick={e => e.stopPropagation()}
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className='flex justify-between items-center mb-3 py-4'>
            <h2 className='text-2xl font-semibold text-stone-800 dark:text-stone-200'>Chat Settings</h2>
            <button onClick={onClose} className='p-1 rounded-md transition-colors' aria-label='Close settings'>
              <i className='bx bx-x text-2xl text-gray-600 dark:text-gray-400 active:scale-95'></i>
            </button>
          </div>

          <div className='space-y-6'>
            {/* Hidden attachment input used for both system prompt + context */}
            <input
              ref={attachmentInputRef}
              type='file'
              accept='application/pdf,text/plain,text/markdown,text/javascript,text/typescript,text/json,.md,.markdown,.js,.jsx,.ts,.tsx,.json,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.kt,.kts,.sh,.bash,.zsh,.yml,.yaml,.toml,.ini,.cfg,.sql,.rb,.php,.swift,.gradle,.bat,.ps1,.scala,.erl,.ex,.r,.csv,.log,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx'
              multiple
              onChange={handleAttachmentInputChange(attachmentTarget)}
              className='hidden'
              aria-hidden='true'
            />

            {/* System Prompt Section */}
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium text-stone-700 dark:text-stone-200'>System prompt</span>
                <button
                  type='button'
                  onClick={() => {
                    setAttachmentTarget('system')
                    attachmentInputRef.current?.click()
                  }}
                  className='flex items-center gap-1 text-sm text-blue-600 dark:text-blue-300 hover:underline'
                >
                  <i className='bx bx-paperclip text-lg' aria-hidden='true'></i>
                  Attach File
                </button>
              </div>
              <InputTextArea
                placeholder='Enter a system prompt to guide the assistant...'
                value={systemPrompt}
                onChange={handleChange}
                minRows={10}
                maxRows={16}
                width='w-full'
                showCharCount
                outline={true}
                showHelp={false}
                variant='outline'
                className='drop-shadow-xl shadow-[0_0px_12px_3px_rgba(0,0,0,0.05),0_0px_2px_0px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)]'
              />
            </div>

            {/* Context Section */}
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium text-stone-700 dark:text-stone-200'>Context</span>
                <button
                  type='button'
                  onClick={() => {
                    setAttachmentTarget('context')
                    attachmentInputRef.current?.click()
                  }}
                  className='flex items-center gap-1 text-sm text-blue-600 dark:text-blue-300 hover:underline'
                >
                  <i className='bx bx-paperclip text-lg' aria-hidden='true'></i>
                  Attach PDF
                </button>
              </div>
              <InputTextArea
                placeholder='Enter a context to augment your chat...'
                value={context}
                onChange={handleContextChange}
                minRows={10}
                maxRows={16}
                width='w-full'
                variant='outline'
                outline={true}
                showHelp={false}
                showCharCount={true}
                className='drop-shadow-xl shadow-[0_0px_12px_3px_rgba(0,0,0,0.05),0_0px_2px_0px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)]'
              />
            </div>

            {/* Tools Section */}
            <div>
              <ToolsSettings />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
