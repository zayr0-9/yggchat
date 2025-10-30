import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { chatSliceActions, Model, sendMessage } from '../../features/chats'
import { Conversation, createConversation } from '../../features/conversations'
import { useAppDispatch } from '../../hooks/redux'
import { useModels } from '../../hooks/useQueries'
import { Button } from '../Button/button'
import { InputTextArea } from '../InputTextArea/InputTextArea'
import { Select } from '../Select/Select'

export const QuickInput: React.FC = () => {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Local state
  const [quickChatInput, setQuickChatInput] = useState('')
  const [selectedModel, setSelectedModel] = useState<Model | null>(null)
  const [think, setThink] = useState(false)
  // const [spinRefresh, setSpinRefresh] = useState(false)
  const [currentProvider] = useState('openrouter') // Default provider

  // Fetch models and refresh mutation
  const { data: modelsData } = useModels(currentProvider)
  const models = modelsData?.models || []
  // const refreshModelsMutation = useRefreshModels()

  // Set default model when models load
  React.useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      setSelectedModel(models[0])
    }
  }, [models, selectedModel])

  // Handle model selection
  const handleModelSelect = useCallback(
    (modelName: string) => {
      const model = models.find(m => m.name === modelName)
      if (model) {
        setSelectedModel(model)
      }
    },
    [models]
  )

  // Handle refresh models
  // const handleRefreshModels = useCallback(() => {
  //   if (currentProvider) {
  //     refreshModelsMutation.mutate(currentProvider)
  //   }
  // }, [currentProvider, refreshModelsMutation])

  // Handle quick chat send
  const handleQuickChatSend = useCallback(async () => {
    const trimmedInput = quickChatInput.trim()
    if (!trimmedInput || !selectedModel) return

    try {
      // 1. Create conversation with null project_id
      const result = await dispatch(
        createConversation({
          title: trimmedInput.slice(0, 50), // First 50 chars as title
          projectId: null, // NULL for quick chats
          systemPrompt: null,
          conversationContext: null,
        })
      ).unwrap()

      // 2. Update React Query caches
      queryClient.setQueryData(['conversations'], (old: Conversation[] | undefined) => {
        return old ? [result, ...old] : [result]
      })

      queryClient.setQueryData(['conversations', 'recent'], (old: Conversation[] | undefined) => {
        return old ? [result, ...old] : [result]
      })

      // 3. Navigate to new conversation
      navigate(`/chat/null/${result.id}`)

      // 4. Set conversation and model in Redux
      dispatch(chatSliceActions.conversationSet(result.id))
      dispatch(chatSliceActions.modelSelected({ model: selectedModel, persist: true }))

      // 5. Clear input
      setQuickChatInput('')

      // 6. Send message after short delay (wait for navigation)
      setTimeout(() => {
        dispatch(
          sendMessage({
            conversationId: result.id,
            input: { content: trimmedInput, modelOverride: null },
            parent: null, // First message has no parent
            repeatNum: 1,
            think: think,
            retrigger: false,
          })
        )
      }, 100)
    } catch (error) {
      console.error('Failed to create quick chat:', error)
    }
  }, [quickChatInput, selectedModel, think, dispatch, queryClient, navigate])

  // Handle Enter key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleQuickChatSend()
      }
    },
    [handleQuickChatSend]
  )

  const canSend = quickChatInput.trim().length > 0 && selectedModel !== null

  return (
    <div className='bg-neutral-100 pb-1 mx-4 my-2 pt-3 2xl:pt-4 outline-1 dark:outline-1 dark:outline-neutral-600 outline-indigo-300 rounded-2xl drop-shadow-xl shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.05)] dark:shadow-[0_0px_24px_1px_rgba(0,0,0,0.65)] dark:bg-yBlack-900'>
      <InputTextArea
        value={quickChatInput}
        onChange={setQuickChatInput}
        onKeyDown={handleKeyDown}
        placeholder='Quick chat...'
        state='default'
        width='w-full'
        minRows={1}
        autoFocus={true}
        showCharCount={true}
      />
      <div className='bg-neutral-100 rounded-b-4xl dark:bg-yBlack-900 flex flex-col items-end pt-3 md:pt-0'>
        <div className='flex justify-between w-full mb-1'>
          <div className='flex items-center justify-start gap-1 flex-wrap flex-1'>
            <Select
              value={selectedModel?.name || ''}
              onChange={handleModelSelect}
              options={models.map(m => m.name)}
              placeholder='Select model...'
              disabled={models.length === 0}
              className='flex-1 ml-2 max-w-28 sm:max-w-28 md:max-w-28 lg:max-w-40 transition-transform duration-60 active:scale-99'
              searchBarVisible={true}
            />
            {/* <Button
              variant='outline2'
              className='rounded-full'
              size='medium'
              onClick={() => {
                setSpinRefresh(true)
                handleRefreshModels()
              }}
            >
              <i
                className={`bx bx-refresh text-[26px] sm:text-[18px] md:text-[16px] lg:text-[18px] 2xl:text-[22px] 3xl:text-[28px] 4xl:text-[24px] ${spinRefresh ? 'animate-[spin_0.6s_linear_1]' : ''}`}
                aria-hidden='true'
                onAnimationEnd={() => setSpinRefresh(false)}
              ></i>
            </Button> */}
            {selectedModel?.thinking && (
              <Button variant='outline2' className='rounded-full' size='medium' onClick={() => setThink(t => !t)}>
                {think ? (
                  <i
                    className='bx bxs-bulb text-yellow-400 text-[22px] sm:text-[18px] md:text-[16px] lg:text-[16px] 2xl:text-[22px] 3xl:text-[28px] 4xl:text-[24px]'
                    aria-hidden='true'
                  ></i>
                ) : (
                  <i
                    className='bx bx-bulb text-[22px] sm:text-[18px] md:text-[16px] lg:text-[16px] 2xl:text-[22px] 3xl:text-[28px] 4xl:text-[24px]'
                    aria-hidden='true'
                  ></i>
                )}
              </Button>
            )}
          </div>
          <div className='flex items-center justify-end pl-2.5'>
            <Button
              variant='outline2'
              size='medium'
              disabled={!canSend}
              onClick={handleQuickChatSend}
              className='rounded-full'
            >
              <i className='bx bx-send text-[22px]' aria-hidden='true'></i>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
