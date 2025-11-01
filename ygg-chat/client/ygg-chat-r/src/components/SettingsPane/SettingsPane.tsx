import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useEffect, useRef } from 'react'
import { selectCurrentConversationId } from '../../features/chats'
import { convContextSet, systemPromptSet, updateContext, updateSystemPrompt } from '../../features/conversations'
import type { Conversation } from '../../features/conversations/conversationTypes'
import { selectSelectedProject } from '../../features/projects'
import { useAppDispatch, useAppSelector } from '../../hooks/redux'
import { InputTextArea } from '../InputTextArea/InputTextArea'
import { ToolsSettings } from './ToolsSettings'

type SettingsPaneProps = {
  open: boolean
  onClose: () => void
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
      <div className='py-2'>
        <div
          className={`relative z-50 mx-4 max-w-3xl rounded-3xl px-12 py-4 lg:py-6 dark:border-1 dark:border-neutral-900 bg-neutral-100 dark:bg-yBlack-900 shadow-lg overflow-y-scroll no-scrollbar transition-all duration-300 ease-in-out ${
            tools.some(tool => tool.enabled) ? 'h-[80vh]' : 'h-[58vh]'
          }`}
          onClick={e => e.stopPropagation()}
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className='flex justify-between items-center mb-3 py-4'>
            <h2 className='text-2xl font-semibold text-stone-800 dark:text-stone-200'>AI Settings</h2>
            <button onClick={onClose} className='p-1 rounded-md transition-colors' aria-label='Close settings'>
              <i className='bx bx-x text-2xl text-gray-600 dark:text-gray-400 active:scale-95'></i>
            </button>
          </div>

          <div className='space-y-6'>
            {/* System Prompt Section */}
            <div>
              <InputTextArea
                label='System prompt'
                placeholder='Enter a system prompt to guide the assistant...'
                value={systemPrompt}
                onChange={handleChange}
                minRows={10}
                maxRows={16}
                width='w-full'
                showCharCount
                outline={true}
                variant='outline'
                className='drop-shadow-xl shadow-[0_0px_12px_3px_rgba(0,0,0,0.05),0_0px_2px_0px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)]'
              />
            </div>

            {/* Context Section */}
            <div>
              <InputTextArea
                label='Context'
                placeholder='Enter a context to augment your chat...'
                value={context}
                onChange={handleContextChange}
                minRows={10}
                maxRows={16}
                width='w-full'
                variant='outline'
                outline={true}
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
