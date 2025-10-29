// React Query hooks for data fetching with automatic caching and deduplication
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import type { BaseModel, Project } from '../../../../shared/types'
import { ConversationId, ProjectId, ProjectWithLatestConversation } from '../../../../shared/types'
import type { Message, Model } from '../features/chats/chatTypes'
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
 *
 * @returns Query result with data, isLoading, isRefetching, and refetch function for manual refresh
 */
export function useProjects() {
  const { accessToken, userId } = useAuth()
  const location = useLocation()

  // Always refetch on Homepage, never on Chat.tsx
  const isHomePage = location.pathname === '/'

  const query = useQuery({
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

  // Expose refetch and isRefetching for manual refresh button
  return {
    ...query,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  }
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
 * @returns Query result with data, isLoading, isRefetching, and refetch function for manual refresh
 */
export function useConversations(enabled: boolean = true) {
  const { accessToken, userId: authUserId } = useAuth()
  // const location = useLocation()

  // Use userId from AuthContext (works for both local mode with UUID and web mode)
  const userId = authUserId

  // Always refetch on ConversationPage, never on Chat.tsx
  // const isConversationPage = location.pathname.includes('/conversationPage')

  const query = useQuery({
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

  // Expose refetch and isRefetching for manual refresh button
  return {
    ...query,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  }
}

/**
 * Fetch conversations for a specific project
 * Cache key: ['conversations', 'project', projectId]
 *
 * Refetch behavior:
 * - ConversationPage: Always refetch to show latest project conversations
 * - Other pages: Never refetch (uses cache)
 *
 * @returns Query result with data, isLoading, isRefetching, and refetch function for manual refresh
 */
export function useConversationsByProject(projectId: ProjectId | null) {
  const { accessToken } = useAuth()
  // const location = useLocation()

  // Always refetch on ConversationPage
  // const isConversationPage = location.pathname.includes('/conversationPage')

  const query = useQuery({
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

  // Expose refetch and isRefetching for manual refresh button
  return {
    ...query,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  }
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

/**
 * Helper function to convert model name string to Model object
 */
const stringToModel = (modelName: string): Model => ({
  name: modelName,
  version: '1.0.0',
  displayName: modelName,
  description: `${modelName} model`,
  inputTokenLimit: 4096,
  outputTokenLimit: 2048,
  thinking: false,
  supportedGenerationMethods: ['chat', 'completion'],
})

/**
 * Fetch models for a specific provider
 * Cache key: ['models', provider]
 *
 * Supports multiple providers: ollama, gemini, anthropic, openai, openrouter, lmstudio
 * Automatically deduplicates requests and caches results
 *
 * Returns: { models: Model[], default: Model }
 */
export function useModels(provider: string | null) {
  const { accessToken } = useAuth()

  return useQuery({
    queryKey: ['models', provider],
    queryFn: async () => {
      if (!provider) throw new Error('Provider is required')

      const normalizedProvider = provider.toLowerCase()
      let endpoint = '/models' // Default to Ollama

      // Map provider to appropriate endpoint
      switch (normalizedProvider) {
        case 'google':
        case 'gemini':
          endpoint = '/models/gemini'
          break
        case 'anthropic':
          endpoint = '/models/anthropic'
          break
        case 'openai':
          endpoint = '/models/openai'
          break
        case 'openrouter':
          endpoint = '/models/openrouter'
          break
        case 'lmstudio':
          endpoint = '/models/lmstudio'
          break
        default:
          endpoint = '/models' // Ollama
      }

      const response = await api.get<{ models: string[] | Model[]; default: string | Model }>(endpoint, accessToken)

      // Handle both string[] and Model[] responses
      const isStringArray = Array.isArray(response.models) && typeof response.models[0] === 'string'

      return {
        models: isStringArray ? (response.models as string[]).map(stringToModel) : (response.models as Model[]),
        default:
          typeof response.default === 'string' ? stringToModel(response.default as string) : (response.default as Model),
      }
    },
    enabled: !!provider && !!accessToken,
    staleTime: 5 * 60 * 1000, // 5 minutes - models don't change frequently
    refetchOnMount: false, // Don't refetch on component mount if cache exists
    refetchOnReconnect: false,
    refetchOnWindowFocus: false, // Don't refetch when user switches tabs
  })
}

/**
 * Fetch recently used models based on message history
 * Cache key: ['models', 'recent']
 *
 * Returns: BaseModel[] (model names with metadata)
 */
export function useRecentModels(limit: number = 5) {
  const { accessToken } = useAuth()

  return useQuery({
    queryKey: ['models', 'recent'],
    queryFn: async () => {
      const query = new URLSearchParams({ limit: String(limit) }).toString()
      const response = await api.get<{ models: string[] }>(`/models/recent?${query}`, accessToken)
      const models = Array.isArray(response?.models) ? response.models : []

      // Map plain names to BaseModel shape with sensible defaults
      const normalized: BaseModel[] = models.map(name => ({
        name,
        version: '',
        displayName: name,
        description: '',
        inputTokenLimit: 0,
        outputTokenLimit: 0,
        thinking: false,
        supportedGenerationMethods: [],
      }))

      return normalized
    },
    enabled: !!accessToken,
    staleTime: 2 * 60 * 1000, // 2 minutes - recent models are more dynamic
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
}

/**
 * Mutation hook for refreshing models (force refetch)
 * Invalidates the models cache for the current provider
 */
export function useRefreshModels() {
  const queryClient = useQueryClient()
  const { accessToken } = useAuth()

  return useMutation({
    mutationFn: async (provider: string) => {
      const normalizedProvider = provider.toLowerCase()
      let endpoint = '/models'

      switch (normalizedProvider) {
        case 'google':
        case 'gemini':
          endpoint = '/models/gemini'
          break
        case 'anthropic':
          endpoint = '/models/anthropic'
          break
        case 'openai':
          endpoint = '/models/openai'
          break
        case 'openrouter':
          endpoint = '/models/openrouter'
          break
        case 'lmstudio':
          endpoint = '/models/lmstudio'
          break
      }

      const response = await api.get<{ models: string[] | Model[]; default: string | Model }>(endpoint, accessToken)
      const isStringArray = Array.isArray(response.models) && typeof response.models[0] === 'string'

      return {
        models: isStringArray ? (response.models as string[]).map(stringToModel) : (response.models as Model[]),
        default:
          typeof response.default === 'string' ? stringToModel(response.default as string) : (response.default as Model),
      }
    },
    onSuccess: (data, provider) => {
      // Update the cache with fresh data
      queryClient.setQueryData(['models', provider], data)
    },
  })
}
