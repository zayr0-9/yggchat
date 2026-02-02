import { QueryClient } from '@tanstack/react-query'
import type { GlobalAgentMessagesData } from './useGlobalAgentMessages'

/**
 * Cache update helper functions for global agent messages
 *
 * These functions provide optimistic updates to the React Query cache
 * for global agent operations, similar to updateMessageCache() in chatActions.ts
 */

/**
 * Append a new message to the global agent messages cache
 *
 * @param queryClient - React Query client instance
 * @param newMessage - Message object to append
 */
export const updateGlobalAgentMessageCache = (
  queryClient: QueryClient | null,
  newMessage: any
) => {
  if (!queryClient) return

  const cacheKey = ['globalAgent', 'messages']
  const existingData = queryClient.getQueryData<GlobalAgentMessagesData>(cacheKey)

  // Initialize cache if empty, then append message
  const currentMessages = existingData?.messages || []
  queryClient.setQueryData(cacheKey, {
    messages: [...currentMessages, newMessage],
    conversationId: existingData?.conversationId || newMessage.conversation_id,
    conversationDate: existingData?.conversationDate || newMessage.created_at
  })
}

/**
 * Set an optimistic message in the cache (shown while task is being processed)
 *
 * @param queryClient - React Query client instance
 * @param optimisticMessage - Temporary message object with _optimistic flag
 */
export const setGlobalAgentOptimisticMessage = (
  queryClient: QueryClient | null,
  optimisticMessage: any
) => {
  if (!queryClient) return

  queryClient.setQueryData(['globalAgent', 'optimisticMessage'], optimisticMessage)
}

/**
 * Clear the optimistic message from cache (after real message arrives)
 *
 * @param queryClient - React Query client instance
 */
export const clearGlobalAgentOptimisticMessage = (
  queryClient: QueryClient | null
) => {
  if (!queryClient) return

  queryClient.setQueryData(['globalAgent', 'optimisticMessage'], null)
}

/**
 * Update the streaming buffer in cache (accumulates text during streaming)
 *
 * @param queryClient - React Query client instance
 * @param streamBuffer - Current accumulated stream text
 */
export const updateGlobalAgentStreamBuffer = (
  queryClient: QueryClient | null,
  streamBuffer: string
) => {
  if (!queryClient) return

  queryClient.setQueryData(['globalAgent', 'streamBuffer'], streamBuffer)
}

/**
 * Clear the streaming buffer from cache (after streaming completes)
 *
 * @param queryClient - React Query client instance
 */
export const clearGlobalAgentStreamBuffer = (
  queryClient: QueryClient | null
) => {
  if (!queryClient) return

  queryClient.setQueryData(['globalAgent', 'streamBuffer'], '')
}

/**
 * Get the current streaming buffer from cache
 *
 * @param queryClient - React Query client instance
 * @returns Current stream buffer string or empty string
 */
export const getGlobalAgentStreamBuffer = (
  queryClient: QueryClient | null
): string => {
  if (!queryClient) return ''

  return queryClient.getQueryData<string>(['globalAgent', 'streamBuffer']) || ''
}

/**
 * Get the current optimistic message from cache
 *
 * @param queryClient - React Query client instance
 * @returns Optimistic message object or null
 */
export const getGlobalAgentOptimisticMessage = (
  queryClient: QueryClient | null
): any | null => {
  if (!queryClient) return null

  return queryClient.getQueryData<any>(['globalAgent', 'optimisticMessage']) || null
}
