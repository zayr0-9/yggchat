import { useCallback, useEffect, useState } from 'react'
import { fetchUserSystemPrompts } from '../features/chats/chatActions'
import { chatSliceActions } from '../features/chats/chatSlice'
import { UserSystemPrompt } from '../features/chats/chatTypes'
import { createUserSystemPrompt } from '../utils/api'
import { useAppDispatch, useAppSelector } from './redux'
import { useAuth } from './useAuth'

const MAX_PROMPT_NAME_LENGTH = 100

export interface UseUserSystemPromptsOptions {
  /** Called when a prompt is selected */
  onPromptSelect?: (content: string) => void
  /** Called when an error occurs */
  onError?: (message: string) => void
  /** Current system prompt content (for checking if it matches existing prompts) */
  currentPromptContent?: string
  /** Whether the modal/component is open (triggers fetch) */
  isOpen?: boolean
}

export interface UseUserSystemPromptsReturn {
  // State
  prompts: UserSystemPrompt[]
  loading: boolean
  selectedPromptId: string | null
  showSavePromptInput: boolean
  savePromptName: string
  savingPrompt: boolean
  saveError: string | null
  isExistingPrompt: boolean

  // Actions
  setSelectedPromptId: (id: string | null) => void
  setShowSavePromptInput: (show: boolean) => void
  setSavePromptName: (name: string) => void
  handleSelectPrompt: (prompt: UserSystemPrompt) => void
  handleSaveAsPrompt: () => Promise<void>
  resetSaveUI: () => void
  clearError: () => void
}

export const useUserSystemPrompts = (options: UseUserSystemPromptsOptions = {}): UseUserSystemPromptsReturn => {
  const { onPromptSelect, onError, currentPromptContent = '', isOpen = true } = options

  const dispatch = useAppDispatch()
  const { accessToken } = useAuth()

  // Redux state
  const { prompts, loading } = useAppSelector(state => state.chat.userSystemPrompts)

  // Local state
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [showSavePromptInput, setShowSavePromptInput] = useState(false)
  const [savePromptName, setSavePromptName] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Check if current content matches any saved prompt
  const isExistingPrompt = prompts.some(prompt => prompt.content.trim() === currentPromptContent.trim())

  // Fetch prompts when modal opens (with caching check)
  useEffect(() => {
    if (isOpen && accessToken && prompts.length === 0 && !loading) {
      dispatch(fetchUserSystemPrompts({ accessToken }))
    }
  }, [isOpen, accessToken, prompts.length, loading, dispatch])

  // Handle selecting a saved prompt
  const handleSelectPrompt = useCallback(
    (prompt: UserSystemPrompt) => {
      setSelectedPromptId(prompt.id)
      onPromptSelect?.(prompt.content)
    },
    [onPromptSelect]
  )

  // Reset save UI state
  const resetSaveUI = useCallback(() => {
    setShowSavePromptInput(false)
    setSavePromptName('')
    setSaveError(null)
  }, [])

  // Clear error
  const clearError = useCallback(() => {
    setSaveError(null)
  }, [])

  // Handle saving current prompt as a new user system prompt
  const handleSaveAsPrompt = useCallback(async () => {
    // Validation
    if (!savePromptName.trim()) {
      const errorMsg = 'Please enter a name for this prompt'
      setSaveError(errorMsg)
      onError?.(errorMsg)
      return
    }

    if (savePromptName.trim().length > MAX_PROMPT_NAME_LENGTH) {
      const errorMsg = `Name must be less than ${MAX_PROMPT_NAME_LENGTH} characters`
      setSaveError(errorMsg)
      onError?.(errorMsg)
      return
    }

    if (!currentPromptContent.trim()) {
      const errorMsg = 'Please enter prompt content'
      setSaveError(errorMsg)
      onError?.(errorMsg)
      return
    }

    if (!accessToken) {
      const errorMsg = 'Authentication required'
      setSaveError(errorMsg)
      onError?.(errorMsg)
      return
    }

    setSavingPrompt(true)
    setSaveError(null)

    try {
      const newPrompt = await createUserSystemPrompt(
        {
          name: savePromptName.trim(),
          content: currentPromptContent.trim(),
        },
        accessToken
      )
      // Add to Redux store
      dispatch(chatSliceActions.userSystemPromptAdded(newPrompt))
      // Reset save prompt UI
      resetSaveUI()
      // Select the newly created prompt
      setSelectedPromptId(newPrompt.id)
    } catch (error) {
      const errorMsg = 'Failed to save prompt. Please try again.'
      console.error('Failed to save system prompt:', error)
      setSaveError(errorMsg)
      onError?.(errorMsg)
    } finally {
      setSavingPrompt(false)
    }
  }, [savePromptName, currentPromptContent, accessToken, dispatch, resetSaveUI, onError])

  return {
    // State
    prompts,
    loading,
    selectedPromptId,
    showSavePromptInput,
    savePromptName,
    savingPrompt,
    saveError,
    isExistingPrompt,

    // Actions
    setSelectedPromptId,
    setShowSavePromptInput,
    setSavePromptName,
    handleSelectPrompt,
    handleSaveAsPrompt,
    resetSaveUI,
    clearError,
  }
}
