import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { environment, localApi } from '../utils/api'
import { useAuth } from './useAuth'

export interface GlobalAgentMessagesData {
  messages: any[]
  conversationId: string | null
  conversationDate: string | null
}

export interface GlobalAgentQueuedTask {
  id: string
  status: string
  description: string
  created_at: string
  payload?: any
  source?: string
  priority?: string
}

export interface GlobalAgentQueuedTasksData {
  tasks: GlobalAgentQueuedTask[]
}

/**
 * React Query hook for global agent messages
 *
 * Provides cached access to global agent messages similar to useConversationMessages
 * for Chat.tsx. Automatically fetches messages from the agent's current conversation
 * and caches them for fast subsequent access.
 *
 * Cache key: ['globalAgent', 'messages']
 * Stale time: 30 seconds (matches Chat.tsx pattern)
 *
 * @returns Query result with messages array and conversation metadata
 */
export function useGlobalAgentMessages() {
  const { userId } = useAuth()

  return useQuery({
    queryKey: ['globalAgent', 'messages'],
    queryFn: async (): Promise<GlobalAgentMessagesData> => {
      // Get agent state to find current conversation
      const stateResponse = await localApi.get<{ success: boolean; state: any }>('/agent/state')
      const conversationId = stateResponse?.state?.conversation_id

      if (!conversationId) {
        return { messages: [], conversationId: null, conversationDate: null }
      }

      // Fetch conversation and messages in parallel
      const [conversation, messages] = await Promise.all([
        localApi.get<any>(`/app/conversations/${conversationId}`).catch(() => null),
        localApi.get<any[]>(`/app/conversations/${conversationId}/messages`).catch(() => [])
      ])

      return {
        messages: messages || [],
        conversationId,
        conversationDate: conversation?.created_at || null
      }
    },
    enabled: !!userId && environment === 'electron',
    staleTime: 5000, // 5 seconds - shorter for agent messages
    refetchOnMount: 'always', // Always fetch latest messages when component mounts
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

/**
 * Subscribe to global agent stream buffer updates
 *
 * This hook triggers re-renders when the stream buffer changes during live streaming.
 * Polls the cache every 100ms for smooth real-time updates.
 *
 * @returns Current stream buffer string
 */
export function useGlobalAgentStreamBuffer(): string {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['globalAgent', 'streamBuffer'],
    queryFn: () => '',  // Initial value - cache is updated by GlobalAgentLoop
    enabled: environment === 'electron',
    staleTime: Infinity, // Never stale - only updated via setQueryData
    refetchInterval: false, // Don't refetch - we poll the cache directly
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  // Poll the cache directly for real-time updates
  const [buffer, setBuffer] = useState('')
  
  useEffect(() => {
    if (environment !== 'electron') return
    
    const interval = setInterval(() => {
      const cached = queryClient.getQueryData<string>(['globalAgent', 'streamBuffer'])
      setBuffer(cached || '')
    }, 100)
    
    return () => clearInterval(interval)
  }, [queryClient])

  return buffer || data || ''
}

/**
 * Subscribe to global agent optimistic message updates
 *
 * This hook triggers re-renders when the optimistic message changes.
 * Shows temporary user messages while they're being processed.
 *
 * @returns Current optimistic message or null
 */
export function useGlobalAgentOptimisticMessage(): any | null {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['globalAgent', 'optimisticMessage'],
    queryFn: () => {
      // Read current optimistic message from cache
      return queryClient.getQueryData<any>(['globalAgent', 'optimisticMessage']) || null
    },
    enabled: environment === 'electron',
    staleTime: 0, // Always fresh
    refetchInterval: 100, // Poll every 100ms
  })

  return data || null
}

/**
 * Fetch queued global agent tasks (pending + scheduled)
 */
export function useGlobalAgentQueuedTasks(enabled: boolean = true) {
  const { userId } = useAuth()

  return useQuery({
    queryKey: ['globalAgent', 'queuedTasks'],
    queryFn: async (): Promise<GlobalAgentQueuedTasksData> => {
      const [pendingResponse, scheduledResponse] = await Promise.all([
        localApi.get<{ success: boolean; tasks: GlobalAgentQueuedTask[] }>('/agent/tasks?status=pending'),
        localApi.get<{ success: boolean; tasks: GlobalAgentQueuedTask[] }>('/agent/tasks?status=scheduled'),
      ])

      const pending = Array.isArray(pendingResponse?.tasks) ? pendingResponse.tasks : []
      const scheduled = Array.isArray(scheduledResponse?.tasks) ? scheduledResponse.tasks : []
      const merged = [...pending, ...scheduled].sort((a, b) => {
        const aTime = Date.parse(a.created_at || '')
        const bTime = Date.parse(b.created_at || '')
        if (Number.isNaN(aTime) || Number.isNaN(bTime)) return 0
        return aTime - bTime
      })

      return { tasks: merged }
    },
    enabled: enabled && !!userId && environment === 'electron',
    staleTime: 1000,
    refetchInterval: enabled ? 3000 : false,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

/**
 * Remove a queued task from execution by marking it completed.
 */
export function useRemoveGlobalAgentQueuedTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (taskId: string) => {
      if (!taskId) {
        throw new Error('Task id is required')
      }
      return localApi.patch(`/agent/tasks/${taskId}`, {
        status: 'completed',
        error: 'removed from queue by user',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalAgent', 'queuedTasks'] })
    },
  })
}
