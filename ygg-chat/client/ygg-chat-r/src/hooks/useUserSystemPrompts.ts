import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createUserSystemPrompt, setDefaultUserSystemPrompt } from '../utils/api'
import { useAuth } from './useAuth'
import { UserSystemPromptCached, useUserSystemPromptsQuery } from './useQueries'

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
  prompts: UserSystemPromptCached[]
  loading: boolean
  selectedPromptId: string | null
  showSavePromptInput: boolean
  savePromptName: string
  savingPrompt: boolean
  saveError: string | null
  isExistingPrompt: boolean
  matchingPrompt: UserSystemPromptCached | null
  makingDefault: boolean

  // Actions
  setSelectedPromptId: (id: string | null) => void
  setShowSavePromptInput: (show: boolean) => void
  setSavePromptName: (name: string) => void
  handleSelectPrompt: (prompt: UserSystemPromptCached) => void
  handleSaveAsPrompt: () => Promise<void>
  handleMakeDefault: () => Promise<void>
  resetSaveUI: () => void
  clearError: () => void
}

export const useUserSystemPrompts = (options: UseUserSystemPromptsOptions = {}): UseUserSystemPromptsReturn => {
  const { onPromptSelect, onError, currentPromptContent = '', isOpen = true } = options

  const queryClient = useQueryClient()
  const { accessToken, userId } = useAuth()

  // Use React Query for system prompts (cached globally)
  const { prompts, isLoading, refetch } = useUserSystemPromptsQuery()

  // Local state
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null)
  const [showSavePromptInput, setShowSavePromptInput] = useState(false)
  const [savePromptName, setSavePromptName] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [makingDefault, setMakingDefault] = useState(false)

  // Find the prompt that matches current content (if any)
  const matchingPrompt = useMemo(() => {
    if (!currentPromptContent.trim()) return null
    return prompts.find(prompt => prompt.content.trim() === currentPromptContent.trim()) || null
  }, [prompts, currentPromptContent])

  // Check if current content matches any saved prompt
  const isExistingPrompt = matchingPrompt !== null

  // Refetch prompts when modal opens to ensure fresh data
  useEffect(() => {
    if (isOpen && accessToken) {
      // Refetch to ensure we have the latest prompts
      refetch()
    }
  }, [isOpen, accessToken, refetch])

  // Handle selecting a saved prompt
  const handleSelectPrompt = useCallback(
    (prompt: UserSystemPromptCached) => {
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

  // Handle making the matching prompt the default
  const handleMakeDefault = useCallback(async () => {
    if (!matchingPrompt) {
      const errorMsg = 'No matching prompt found'
      setSaveError(errorMsg)
      onError?.(errorMsg)
      return
    }

    if (matchingPrompt.is_default) {
      // Already the default, nothing to do
      return
    }

    if (!accessToken) {
      const errorMsg = 'Authentication required'
      setSaveError(errorMsg)
      onError?.(errorMsg)
      return
    }

    setMakingDefault(true)
    setSaveError(null)

    try {
      const updatedPrompt = await setDefaultUserSystemPrompt(matchingPrompt.id, accessToken)

      // Update React Query cache - set is_default to false for all other prompts
      queryClient.setQueryData<UserSystemPromptCached[]>(['userSystemPrompts', userId], old => {
        if (!old) return [updatedPrompt]
        return old.map(p => ({
          ...p,
          is_default: p.id === updatedPrompt.id,
        }))
      })

      // Select the prompt
      setSelectedPromptId(updatedPrompt.id)
    } catch (error) {
      const errorMsg = 'Failed to set default prompt. Please try again.'
      console.error('Failed to set default system prompt:', error)
      setSaveError(errorMsg)
      onError?.(errorMsg)
    } finally {
      setMakingDefault(false)
    }
  }, [matchingPrompt, accessToken, queryClient, userId, onError])

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

      // Update React Query cache with the new prompt
      queryClient.setQueryData<UserSystemPromptCached[]>(['userSystemPrompts', userId], old => {
        if (!old) return [newPrompt]
        return [...old, newPrompt]
      })

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
  }, [savePromptName, currentPromptContent, accessToken, queryClient, userId, resetSaveUI, onError])

  return {
    // State
    prompts,
    loading: isLoading,
    selectedPromptId,
    showSavePromptInput,
    savePromptName,
    savingPrompt,
    saveError,
    isExistingPrompt,
    matchingPrompt,
    makingDefault,

    // Actions
    setSelectedPromptId,
    setShowSavePromptInput,
    setSavePromptName,
    handleSelectPrompt,
    handleSaveAsPrompt,
    handleMakeDefault,
    resetSaveUI,
    clearError,
  }
}
