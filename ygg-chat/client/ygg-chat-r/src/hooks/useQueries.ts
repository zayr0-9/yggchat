// React Query hooks for data fetching with automatic caching and deduplication
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import type { Project } from '../../../../shared/types'
import { ConversationId, ProjectId, ProjectWithLatestConversation } from '../../../../shared/types'
import type { Message } from '../features/chats/chatTypes'
import type { Conversation } from '../features/conversations/conversationTypes'
import { api } from '../utils/api'
import { useAuth } from './useAuth'

/**
 * Fetch all projects for the current user, sorted by latest conversation
 * Cache key: ['projects']
 * Returns projects with latest_conversation_updated_at for efficient sorting
 * Eliminates need to fetch all conversations separately
 *
 * Refetch behavior:
 * - Homepage: Always refetch to show latest projects
 * - Chat.tsx: Never refetch (uses persisted cache for instant UI)
 */
export function useProjects() {
  const { accessToken, userId } = useAuth()
  const location = useLocation()

  // Always refetch on Homepage, never on Chat.tsx
  const isHomePage = location.pathname === '/'

  return useQuery({
    queryKey: ['projects', userId],
    queryFn: async () => {
      return api.get<ProjectWithLatestConversation[]>(
        `/projects/sorted/latest-conversation?userId=${userId}`,
        accessToken
      )
    },
    enabled: !!accessToken && !!userId,
    staleTime: 10 * 60 * 1000, // Projects don't change often, 10 minute cache
    refetchOnMount: isHomePage ? 'always' : false, // Force fresh data on Homepage
    refetchOnReconnect: false,
    refetchOnWindowFocus: false, // Don't refetch when user switches tabs
  })
}

/**
 * Fetch a single project by ID
 * Cache key: ['projects', projectId]
 */
export function useProject(projectId: ProjectId | null) {
  const { accessToken } = useAuth()

  return useQuery({
    queryKey: ['projects', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID is required')
      return api.get<Project>(`/projects/${projectId}`, accessToken)
    },
    enabled: !!projectId && !!accessToken,
    staleTime: 10000,
  })
}

/**
 * Fetch all conversations for the current user
 * Cache key: ['conversations']
 *
 * Refetch behavior:
 * - ConversationPage: Always refetch to show latest conversations
 * - Chat.tsx: Never refetch (uses persisted cache for instant UI)
 *
 * @param enabled - Optional flag to control whether the query runs (default: true)
 */
export function useConversations(enabled: boolean = true) {
  const { accessToken, userId: authUserId } = useAuth()
  // const location = useLocation()

  // Use userId from AuthContext (works for both local mode with UUID and web mode)
  const userId = authUserId

  // Always refetch on ConversationPage, never on Chat.tsx
  // const isConversationPage = location.pathname.includes('/conversationPage')

  return useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      if (!userId) throw new Error('User not authenticated')
      return api.get<Conversation[]>(`/users/${userId}/conversations`, accessToken)
    },
    enabled: enabled && !!userId && !!accessToken,
    staleTime: 5 * 60 * 1000, // Conversations list doesn't change often, 5 minute cache
    // refetchOnMount: isConversationPage ? 'always' : false, // Force fresh data on ConversationPage
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false, // Don't refetch when user switches tabs
  })
}

/**
 * Fetch conversations for a specific project
 * Cache key: ['conversations', 'project', projectId]
 *
 * Refetch behavior:
 * - ConversationPage: Always refetch to show latest project conversations
 * - Other pages: Never refetch (uses cache)
 */
export function useConversationsByProject(projectId: ProjectId | null) {
  const { accessToken } = useAuth()
  // const location = useLocation()

  // Always refetch on ConversationPage
  // const isConversationPage = location.pathname.includes('/conversationPage')

  return useQuery({
    queryKey: ['conversations', 'project', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID is required')
      return api.get<Conversation[]>(`/conversations/project/${projectId}`, accessToken)
    },
    enabled: !!projectId && !!accessToken,
    staleTime: 5 * 60 * 1000, // Project conversations don't change often, 5 minute cache
    // refetchOnMount: isConversationPage ? 'always' : false, // Force fresh data on ConversationPage
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false, // Don't refetch when user switches tabs
  })
}

/**
 * Fetch recent conversations with a limit
 * Cache key: ['conversations', 'recent']
 * Note: limit only affects the API call, not the cache key
 */
export function useRecentConversations(limit: number = 8) {
  const { accessToken, userId: authUserId } = useAuth()

  // Use userId from AuthContext (works for both local mode with UUID and web mode)
  const userId = authUserId

  return useQuery({
    queryKey: ['conversations', 'recent'],
    queryFn: async () => {
      if (!userId) throw new Error('User not authenticated')
      const query = new URLSearchParams({ limit: String(limit) }).toString()
      const response = await api.get<any[]>(`/users/${userId}/conversations/recent?${query}`, accessToken)

      // Transform server response to client format
      // - Local mode: user_id is number, convert to string
      // - Web mode: owner_id is string UUID, map to user_id
      const normalized: Conversation[] = response.map((conv: any) => ({
        ...conv,
        id: String(conv.id),
        user_id: conv.owner_id || String(conv.user_id),
        project_id: conv.project_id ? String(conv.project_id) : null,
      }))

      return normalized
    },
    enabled: !!userId && !!accessToken,
    staleTime: 5 * 60 * 1000, // Recent conversations list, 5 minute cache
    refetchOnMount: false, // Don't refetch if data exists
    refetchOnReconnect: false,
    refetchOnWindowFocus: false, // Don't refetch when user switches tabs
  })
}

/**
 * Fetch all data for a conversation (messages, tree, system prompt, context)
 * Cache key: ['conversations', conversationId, 'data']
 */
export function useConversationData(conversationId: ConversationId | null) {
  const { accessToken } = useAuth()

  return useQuery({
    queryKey: ['conversations', conversationId, 'data'],
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required')

      // Fetch all data in parallel
      const [messages, treeData, systemPromptRes, contextRes] = await Promise.all([
        api.get<Message[]>(`/conversations/${conversationId}/messages`, accessToken),
        api.get<any>(`/conversations/${conversationId}/messages/tree`, accessToken),
        api.get<{ systemPrompt: string | null }>(`/conversations/${conversationId}/system-prompt`, accessToken),
        api.get<{ context: string | null }>(`/conversations/${conversationId}/context`, accessToken),
      ])

      return {
        messages: messages || [],
        treeData,
        systemPrompt: systemPromptRes?.systemPrompt ?? null,
        context: contextRes?.context ?? null,
      }
    },
    enabled: !!conversationId && !!accessToken,
    staleTime: 2000, // Conversation data changes frequently during chat
  })
}

/**
 * Fetch messages and tree data for a conversation in a single request
 * Cache key: ['conversations', conversationId, 'messages']
 *
 * IMPORTANT: This hook provides automatic request deduplication.
 * Multiple components calling this with the same conversationId will share
 * a single network request and cached result.
 *
 * Returns: { messages: Message[], tree: ChatNode }
 */
export function useConversationMessages(conversationId: ConversationId | null) {
  const { accessToken } = useAuth()

  return useQuery({
    queryKey: ['conversations', conversationId, 'messages'],
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required')
      // Use /messages/tree endpoint to get both messages AND tree in one request
      return api.get<{ messages: Message[]; tree: any }>(`/conversations/${conversationId}/messages/tree`, accessToken)
    },
    enabled: !!conversationId && !!accessToken,
    staleTime: 30000, // 30 seconds - messages only change on user actions (send/edit/branch)
    // Aggressive deduplication: only refetch if data is truly stale
    refetchOnMount: false, // Don't refetch on component mount if data exists
    refetchOnReconnect: false, // Don't refetch on network reconnect
    refetchOnWindowFocus: false, // Don't refetch when user switches tabs
  })
}
