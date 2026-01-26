import { useQueryClient } from '@tanstack/react-query'
import mammoth from 'mammoth'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { selectCurrentConversationId } from '../../features/chats'
import { convContextSet, systemPromptSet, updateContext, updateSystemPrompt } from '../../features/conversations'
import type { Conversation } from '../../features/conversations/conversationTypes'
import { selectSelectedProject } from '../../features/projects'
import { useAppDispatch, useAppSelector } from '../../hooks/redux'
import { useUserSystemPrompts } from '../../hooks/useUserSystemPrompts'
import { extractTextFromPdf } from '../../utils/pdfUtils'
import { InputTextArea } from '../InputTextArea/InputTextArea'
import { SendButtonAnimationSettings } from './SendButtonAnimationSettings'
import { ToolsSettings } from './ToolsSettings'
import { VoiceSettingsSection } from './VoiceSettingsSection'

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
  const [promptContextExpanded, setPromptContextExpanded] = useState(false)

  // Skills section state
  const [skillsExpanded, setSkillsExpanded] = useState(false)
  const [skillUrl, setSkillUrl] = useState('')
  const [skillInstallStatus, setSkillInstallStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [skillInstallMessage, setSkillInstallMessage] = useState('')
  const [installedSkills, setInstalledSkills] = useState<Array<{ name: string; description: string; enabled: boolean }>>([])
  const [skillsLoading, setSkillsLoading] = useState(false)

  // Font size offset state (persisted to localStorage)
  const [fontSizeOffset, setFontSizeOffset] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('chat:fontSizeOffset')
      return stored ? parseInt(stored, 10) : 0
    } catch {
      return 0
    }
  })

  const handleFontSizeChange = useCallback((value: number) => {
    const next = Math.max(-8, Math.min(16, value)) // Clamp between -8 and +16
    setFontSizeOffset(next)
    try {
      localStorage.setItem('chat:fontSizeOffset', String(next))
      window.dispatchEvent(new CustomEvent('fontSizeOffsetChange', { detail: next }))
    } catch {
      // Ignore localStorage errors
    }
  }, [])

  // Use the custom hook for system prompt management
  const {
    prompts: userSystemPrompts,
    loading: promptsLoading,
    selectedPromptId,
    setSelectedPromptId,
    showSavePromptInput,
    setShowSavePromptInput,
    savePromptName,
    setSavePromptName,
    savingPrompt,
    saveError,
    isExistingPrompt,
    matchingPrompt,
    makingDefault,
    handleSelectPrompt,
    handleSaveAsPrompt,
    handleMakeDefault,
    handleRemoveDefault,
    removingDefault,
    resetSaveUI,
  } = useUserSystemPrompts({
    currentPromptContent: systemPrompt,
    isOpen: open,
    onPromptSelect: content => dispatch(systemPromptSet(content)),
  })

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

  // Fetch installed skills
  const fetchInstalledSkills = useCallback(async () => {
    setSkillsLoading(true)
    try {
      const response = await fetch('http://127.0.0.1:3002/api/skills')
      const data = await response.json()
      if (data.success && data.skills) {
        setInstalledSkills(data.skills)
      }
    } catch (error) {
      console.error('Failed to fetch installed skills:', error)
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  // Fetch skills when section is expanded
  useEffect(() => {
    if (skillsExpanded) {
      fetchInstalledSkills()
    }
  }, [skillsExpanded, fetchInstalledSkills])

  // Handle skill installation from URL
  const handleInstallSkill = useCallback(async () => {
    const url = skillUrl.trim()
    if (!url) return

    setSkillInstallStatus('loading')
    setSkillInstallMessage('Downloading and installing skill...')

    try {
      const response = await fetch('http://127.0.0.1:3002/api/skills/install/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })

      const data = await response.json()

      if (data.success) {
        setSkillInstallStatus('success')
        setSkillInstallMessage(`Successfully installed "${data.skillName}"`)
        setSkillUrl('')
        // Refresh skills list
        fetchInstalledSkills()
        // Auto-clear success message after 5 seconds
        setTimeout(() => {
          setSkillInstallStatus('idle')
          setSkillInstallMessage('')
        }, 5000)
      } else {
        setSkillInstallStatus('error')
        setSkillInstallMessage(data.error || 'Installation failed')
      }
    } catch (error) {
      setSkillInstallStatus('error')
      setSkillInstallMessage(error instanceof Error ? error.message : 'Network error - is the local server running?')
    }
  }, [skillUrl, fetchInstalledSkills])

  // Handle skill enable/disable toggle
  const handleToggleSkill = useCallback(async (skillName: string, currentEnabled: boolean) => {
    const action = currentEnabled ? 'disable' : 'enable'
    try {
      const response = await fetch(`http://127.0.0.1:3002/api/skills/${encodeURIComponent(skillName)}/${action}`, {
        method: 'POST',
      })
      const data = await response.json()
      if (data.success) {
        // Update local state
        setInstalledSkills(prev => prev.map(s =>
          s.name === skillName ? { ...s, enabled: !currentEnabled } : s
        ))
      }
    } catch (error) {
      console.error(`Failed to ${action} skill:`, error)
    }
  }, [])

  // Handle skill uninstall
  const handleUninstallSkill = useCallback(async (skillName: string) => {
    if (!confirm(`Are you sure you want to uninstall "${skillName}"?`)) return

    try {
      const response = await fetch(`http://127.0.0.1:3002/api/skills/${encodeURIComponent(skillName)}`, {
        method: 'DELETE',
      })
      const data = await response.json()
      if (data.success) {
        // Remove from local state
        setInstalledSkills(prev => prev.filter(s => s.name !== skillName))
      }
    } catch (error) {
      console.error('Failed to uninstall skill:', error)
    }
  }, [])

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
      <div className='py-2 w-full max-w-5xl'>
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

            {/* System Prompt and Context Collapsible Section */}
            <div className='space-y-2'>
              <button
                type='button'
                onClick={() => setPromptContextExpanded(!promptContextExpanded)}
                className='flex items-center justify-between w-full text-left'
              >
                <span className='text-[16px] font-medium text-stone-700 dark:text-stone-200'>
                  System Prompt and Context
                </span>
                <i
                  className={`bx bx-chevron-down text-xl text-neutral-500 dark:text-neutral-400 transition-transform duration-200 ${promptContextExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {promptContextExpanded && (
                <div className='space-y-6 pl-1 pt-2'>
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

                    {/* User System Prompts horizontal scrolling list */}
                    {userSystemPrompts.length > 0 && (
                      <div className='mb-2'>
                        <p className='text-sm text-neutral-600 dark:text-neutral-400 mb-2'>Select a saved prompt:</p>
                        <div className='flex gap-2 overflow-x-auto pb-2 thin-scrollbar'>
                          {userSystemPrompts.map(prompt => (
                            <button
                              key={prompt.id}
                              onClick={() => handleSelectPrompt(prompt)}
                              className={`flex items-center justify-center gap-2 flex-shrink-0 h-10 px-4 rounded-xl border transition-all duration-150 ${
                                selectedPromptId === prompt.id
                                  ? 'bg-sky-600/70 text-white border-transparent'
                                  : 'bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-transparent dark:border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-700'
                              }`}
                              title={prompt.description || prompt.content.substring(0, 100)}
                            >
                              <span className='font-medium text-sm whitespace-nowrap'>{prompt.name}</span>
                              {prompt.is_default && (
                                <span className=' pt-0.5 text-xs opacity-70'>
                                  <i className='bx bxs-star text-base'></i>
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {promptsLoading && (
                      <div className='mb-2 text-sm text-neutral-500 dark:text-neutral-400'>
                        Loading saved prompts...
                      </div>
                    )}

                    <InputTextArea
                      placeholder='Enter a system prompt to guide the assistant...'
                      value={systemPrompt}
                      onChange={value => {
                        handleChange(value)
                        // Clear selection if user manually edits the prompt
                        if (selectedPromptId) setSelectedPromptId(null)
                      }}
                      minRows={10}
                      maxRows={16}
                      width='w-full'
                      showCharCount
                      outline={true}
                      showHelp={false}
                      variant='outline'
                      className='drop-shadow-xl shadow-[0_0px_12px_3px_rgba(0,0,0,0.05),0_0px_2px_0px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)]'
                    />

                    {/* Save as Prompt / Make Default button */}
                    {systemPrompt.trim() && (
                      <div className='mt-3'>
                        {isExistingPrompt ? (
                          // Show "Make Default" or "Remove Default" button when prompt already exists
                          matchingPrompt &&
                          (matchingPrompt.is_default ? (
                            <button
                              type='button'
                              onClick={handleRemoveDefault}
                              disabled={removingDefault}
                              className='flex items-center gap-2 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50'
                            >
                              <i className='bx bxs-star text-base'></i>
                              {removingDefault ? 'Removing...' : 'Remove Default'}
                            </button>
                          ) : (
                            <button
                              type='button'
                              onClick={handleMakeDefault}
                              disabled={makingDefault}
                              className='flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors disabled:opacity-50'
                            >
                              <i className='bx bx-star text-base'></i>
                              {makingDefault ? 'Setting...' : 'Make Default'}
                            </button>
                          ))
                        ) : (
                          // Show "Save as Prompt" when content doesn't match existing prompt
                          <>
                            {!showSavePromptInput ? (
                              <button
                                type='button'
                                onClick={() => setShowSavePromptInput(true)}
                                className='flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors'
                              >
                                <i className='bx bx-save text-base'></i>
                                Save as Prompt
                              </button>
                            ) : (
                              <div className='space-y-2'>
                                <div className='flex items-center gap-2'>
                                  <input
                                    type='text'
                                    value={savePromptName}
                                    onChange={e => setSavePromptName(e.target.value)}
                                    placeholder='Enter prompt name...'
                                    maxLength={100}
                                    className='flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-transparent'
                                    autoFocus
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleSaveAsPrompt()
                                      if (e.key === 'Escape') resetSaveUI()
                                    }}
                                  />
                                  <button
                                    type='button'
                                    onClick={handleSaveAsPrompt}
                                    disabled={!savePromptName.trim() || savingPrompt}
                                    className='px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                                  >
                                    {savingPrompt ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    type='button'
                                    onClick={resetSaveUI}
                                    className='px-2 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors'
                                  >
                                    <i className='bx bx-x text-lg'></i>
                                  </button>
                                </div>
                                {saveError && <p className='text-sm text-red-500 dark:text-red-400'>{saveError}</p>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
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
                        Attach File
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
                </div>
              )}
            </div>

            {/* Font Size Section */}
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium text-stone-700 dark:text-stone-200'>Message Font Size</span>
                <span className='text-sm font-mono text-neutral-600 dark:text-neutral-400'>
                  {fontSizeOffset === 0 ? 'Default' : `${fontSizeOffset > 0 ? '+' : ''}${fontSizeOffset}px`}
                </span>
              </div>
              <div className='flex items-center gap-4'>
                <span className='text-xs text-neutral-500 dark:text-neutral-500 w-6'>-8</span>
                <input
                  type='range'
                  min={-8}
                  max={16}
                  step={1}
                  value={fontSizeOffset}
                  onChange={e => handleFontSizeChange(parseInt(e.target.value, 10))}
                  className='flex-1 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500'
                />
                <span className='text-xs text-neutral-500 dark:text-neutral-500 w-6'>+16</span>
                <button
                  type='button'
                  onClick={() => handleFontSizeChange(0)}
                  className={`px-3 py-1.5 rounded-lg text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors ${fontSizeOffset === 0 ? 'invisible' : ''}`}
                  title='Reset to default'
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Voice Settings Section */}
            <VoiceSettingsSection />

            {/* Send Button Animation Section */}
            <div className='space-y-2'>
              <SendButtonAnimationSettings />
            </div>

            {/* Tools Section */}
            <div>
              <ToolsSettings />
            </div>

            {/* Skills Section */}
            <div className='space-y-2'>
              <button
                type='button'
                onClick={() => setSkillsExpanded(!skillsExpanded)}
                className='flex items-center justify-between w-full text-left'
              >
                <span className='text-[16px] font-medium text-stone-700 dark:text-stone-200'>Skills</span>
                <i
                  className={`bx bx-chevron-down text-xl text-neutral-500 dark:text-neutral-400 transition-transform duration-200 ${skillsExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {skillsExpanded && (
                <div className='space-y-4 pl-1 pt-2'>
                  <p className='text-sm text-neutral-600 dark:text-neutral-400'>
                    Install skills from{' '}
                    <a
                      href='https://clawdhub.com/skills'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-blue-600 dark:text-blue-400 hover:underline'
                    >
                      ClawdHub
                    </a>{' '}
                    or GitHub. Paste the skill page URL below.
                  </p>

                  {/* URL Input and Install Button */}
                  <div className='flex items-center gap-2'>
                    <input
                      type='text'
                      value={skillUrl}
                      onChange={e => setSkillUrl(e.target.value)}
                      placeholder='https://clawdhub.com/owner/skill-name'
                      className='flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
                      disabled={skillInstallStatus === 'loading'}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && skillUrl.trim()) {
                          handleInstallSkill()
                        }
                      }}
                    />
                    <button
                      type='button'
                      onClick={handleInstallSkill}
                      disabled={!skillUrl.trim() || skillInstallStatus === 'loading'}
                      className='px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2'
                    >
                      {skillInstallStatus === 'loading' ? (
                        <>
                          <i className='bx bx-loader-alt animate-spin text-base'></i>
                          Installing...
                        </>
                      ) : (
                        <>
                          <i className='bx bx-download text-base'></i>
                          Install
                        </>
                      )}
                    </button>
                  </div>

                  {/* Status Message */}
                  {skillInstallMessage && (
                    <div
                      className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                        skillInstallStatus === 'success'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : skillInstallStatus === 'error'
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}
                    >
                      <i
                        className={`bx ${
                          skillInstallStatus === 'success'
                            ? 'bx-check-circle'
                            : skillInstallStatus === 'error'
                              ? 'bx-error-circle'
                              : 'bx-loader-alt animate-spin'
                        } text-base`}
                      ></i>
                      {skillInstallMessage}
                    </div>
                  )}

                  {/* Help text */}
                  <p className='text-xs text-neutral-500 dark:text-neutral-500'>
                    Supported URLs: ClawdHub pages (clawdhub.com/owner/skill), GitHub repos
                  </p>

                  {/* Installed Skills List */}
                  <div className='mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-700'>
                    <h4 className='text-sm font-medium text-stone-700 dark:text-stone-200 mb-3'>
                      Installed Skills {!skillsLoading && `(${installedSkills.length})`}
                    </h4>

                    {skillsLoading ? (
                      <div className='flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400'>
                        <i className='bx bx-loader-alt animate-spin'></i>
                        Loading skills...
                      </div>
                    ) : installedSkills.length === 0 ? (
                      <p className='text-sm text-neutral-500 dark:text-neutral-400'>
                        No skills installed yet. Install one from ClawdHub or GitHub above.
                      </p>
                    ) : (
                      <div className='space-y-2'>
                        {installedSkills.map(skill => (
                          <div
                            key={skill.name}
                            className='flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700'
                          >
                            <div className='flex-1 min-w-0'>
                              <div className='flex items-center gap-2'>
                                <span className='font-medium text-sm text-neutral-900 dark:text-neutral-100'>
                                  {skill.name}
                                </span>
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded ${
                                    skill.enabled
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                      : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'
                                  }`}
                                >
                                  {skill.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                              </div>
                              <p className='text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5'>
                                {skill.description}
                              </p>
                            </div>
                            <div className='flex items-center gap-1 ml-2'>
                              <button
                                type='button'
                                onClick={() => handleToggleSkill(skill.name, skill.enabled)}
                                className='p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors'
                                title={skill.enabled ? 'Disable skill' : 'Enable skill'}
                              >
                                <i
                                  className={`bx ${skill.enabled ? 'bx-toggle-right text-green-500' : 'bx-toggle-left text-neutral-400'} text-xl`}
                                ></i>
                              </button>
                              <button
                                type='button'
                                onClick={() => handleUninstallSkill(skill.name)}
                                className='p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-neutral-400 hover:text-red-500'
                                title='Uninstall skill'
                              >
                                <i className='bx bx-trash text-lg'></i>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
