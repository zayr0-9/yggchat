// React Query hooks for data fetching with automatic caching and deduplication
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { BaseModel, Project } from '../../../../shared/types'
import { ConversationId, ProjectId, ProjectWithLatestConversation } from '../../../../shared/types'
import type { Message, Model } from '../features/chats/chatTypes'
import type { Conversation } from '../features/conversations/conversationTypes'
import { api, environment, localApi } from '../utils/api'
import { getFavoritedModels } from '../utils/favorites'
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
      // In Electron mode, fetch both cloud and local projects
      if (environment === 'electron') {
        const [cloudProjects, localProjects] = await Promise.all([
          api.get<ProjectWithLatestConversation[]>(
            `/projects/sorted/latest-conversation?userId=${userId}`,
            accessToken
          ).catch(err => {
            console.error('Failed to fetch cloud projects:', err)
            return []
          }),
          localApi.get<ProjectWithLatestConversation[]>(`/local/projects?userId=${userId}`)
            .catch(err => {
              console.error('Failed to fetch local projects:', err)
              return []
            })
        ])

        // Merge and sort by latest_conversation_updated_at or updated_at
        const merged = [...cloudProjects, ...localProjects]
          .sort((a, b) => {
            const dateA = new Date(a.latest_conversation_updated_at || a.updated_at).getTime()
            const dateB = new Date(b.latest_conversation_updated_at || b.updated_at).getTime()
            return dateB - dateA
          })

        return merged
      }

      // Web mode: cloud only
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

      // In Electron mode, fetch both cloud and local conversations
      if (environment === 'electron') {
        const [cloudConversations, localConversations] = await Promise.all([
          api.get<Conversation[]>(`/users/${userId}/conversations`, accessToken)
            .catch(err => {
              console.error('Failed to fetch cloud conversations:', err)
              return []
            }),
          localApi.get<Conversation[]>(`/local/conversations?userId=${userId}`)
            .catch(err => {
              console.error('Failed to fetch local conversations:', err)
              return []
            })
        ])

        // Merge and sort by updated_at
        const merged = [...cloudConversations, ...localConversations]
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

        return merged
      }

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
  const { accessToken, userId } = useAuth()
  // const location = useLocation()

  // Always refetch on ConversationPage
  // const isConversationPage = location.pathname.includes('/conversationPage')

  const query = useQuery({
    queryKey: ['conversations', 'project', projectId],
    queryFn: async () => {
      if (!projectId) throw new Error('Project ID is required')

      // In Electron mode, fetch both cloud and local conversations
      if (environment === 'electron') {
        const [cloudConversations, localConversations] = await Promise.all([
          api.get<Conversation[]>(`/conversations/project/${projectId}`, accessToken)
            .catch(err => {
              console.error('Failed to fetch cloud project conversations:', err)
              return []
            }),
          localApi.get<Conversation[]>(`/local/conversations?userId=${userId}`)
            .then(convs => convs.filter(c => c.project_id === projectId))
            .catch(err => {
              console.error('Failed to fetch local project conversations:', err)
              return []
            })
        ])

        // Merge and sort by updated_at
        const merged = [...cloudConversations, ...localConversations]
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

        return merged
      }

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
  id: modelName,
  name: modelName,
  version: '1.0.0',
  displayName: modelName,
  description: `${modelName} model`,
  contextLength: 4096,
  maxCompletionTokens: 2048,
  inputTokenLimit: 4096,
  outputTokenLimit: 2048,
  promptCost: 0,
  completionCost: 0,
  requestCost: 0,
  thinking: false,
  supportsImages: false,
  supportsWebSearch: false,
  supportsStructuredOutputs: false,
  inputModalities: ['text'],
  outputModalities: ['text'],
  defaultTemperature: null,
  defaultTopP: null,
  defaultFrequencyPenalty: null,
  topProviderContextLength: null,
})

/**
 * Helper function to read selected model from localStorage
 * Returns null if not found or invalid
 */
const getStoredSelectedModel = (): Model | null => {
  try {
    const raw = localStorage.getItem('selectedModel')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') {
      return parsed as Model
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fetch models for a specific provider
 * Cache key: ['models', provider]
 *
 * Supports multiple providers: ollama, gemini, anthropic, openai, openrouter, lmstudio
 * Automatically deduplicates requests and caches results
 *
 * Returns: { models: Model[], default: Model, selected: Model }
 * The selected field contains the currently selected model (persisted from localStorage or defaults to server default)
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

      const models = isStringArray ? (response.models as string[]).map(stringToModel) : (response.models as Model[])
      let defaultModel =
        typeof response.default === 'string' ? stringToModel(response.default as string) : (response.default as Model)

      // For OpenRouter, prefer openai/gpt-5-mini if it exists
      if (normalizedProvider === 'openrouter') {
        const gpt5Mini = models.find(m => m.name === 'openai/gpt-5-mini')
        if (gpt5Mini) {
          defaultModel = gpt5Mini
        }
      }

      // Determine selected model: use localStorage if valid, otherwise use server default
      const storedSelection = getStoredSelectedModel()
      let selectedModel = defaultModel

      // If stored selection exists and matches a model in the list, use the full model data from the list
      if (storedSelection) {
        const matchedModel = models.find(m => m.name === storedSelection.name)
        if (matchedModel) {
          selectedModel = matchedModel
        }
      }

      return {
        models,
        default: defaultModel,
        selected: selectedModel, // Always populated - either from localStorage (if valid) or from server default
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
        id: name,
        name,
        version: '',
        displayName: name,
        description: '',
        contextLength: 0,
        maxCompletionTokens: 0,
        inputTokenLimit: 0,
        outputTokenLimit: 0,
        promptCost: 0,
        completionCost: 0,
        requestCost: 0,
        thinking: false,
        supportsImages: false,
        supportsWebSearch: false,
        supportsStructuredOutputs: false,
        inputModalities: ['text'],
        outputModalities: ['text'],
        defaultTemperature: null,
        defaultTopP: null,
        defaultFrequencyPenalty: null,
        topProviderContextLength: null,
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
 * Research note item returned from API
 */
export interface ResearchNoteItem {
  id: string
  title: string
  research_note: string
  updated_at: string
  project_id: string | null
}

/**
 * Fetch all research notes for the current user
 * Cache key: ['research-notes', userId]
 *
 * Returns: Array of research notes with conversation metadata
 * Only returns conversations with non-empty research notes
 *
 * @returns Query result with data, isLoading, isRefetching, and refetch function
 */
export function useResearchNotes() {
  const { accessToken, userId } = useAuth()

  return useQuery({
    queryKey: ['research-notes', userId],
    queryFn: async () => {
      if (!userId) throw new Error('User not authenticated')
      return api.get<ResearchNoteItem[]>(`/users/${userId}/research-notes`, accessToken)
    },
    enabled: !!userId && !!accessToken,
    staleTime: 5 * 60 * 1000, // 5 minutes - research notes don't change often
    refetchOnMount: false, // Don't refetch if data exists
    refetchOnReconnect: false,
    refetchOnWindowFocus: false, // Don't refetch when user switches tabs
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

/**
 * Mutation hook for selecting a model for the current provider
 * Updates both React Query cache and localStorage
 *
 * Usage:
 * const selectModelMutation = useSelectModel()
 * selectModelMutation.mutate({ provider: 'openrouter', model: selectedModel })
 */
export function useSelectModel() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ provider, model }: { provider: string; model: Model }) => {
      // Persist to localStorage
      localStorage.setItem('selectedModel', JSON.stringify(model))
      return { provider, model }
    },
    onSuccess: ({ provider, model }) => {
      // Update the React Query cache with selected model
      queryClient.setQueryData(['models', provider], (oldData: any) => {
        if (!oldData) return oldData
        return {
          ...oldData,
          selected: model,
        }
      })
    },
  })
}

/**
 * Hook to get the currently selected model for a provider
 * Returns the selected model from the cache, or null if loading
 *
 * Usage:
 * const selectedModel = useSelectedModel(currentProvider)
 */
export function useSelectedModel(provider: string | null) {
  const { data } = useModels(provider)
  return data?.selected || null
}

/**
 * Hook to get the effective model (always returns a model, never null)
 * Returns selected model if available, otherwise default model
 *
 * Usage:
 * const effectiveModel = useEffectiveModel(currentProvider)
 */
export function useEffectiveModel(provider: string | null) {
  const { data } = useModels(provider)
  return data?.selected || data?.default || null
}

/**
 * Hook to manage a local mutable copy of models with filtering capabilities
 * Creates a working copy that can be filtered by various criteria without affecting the cache
 *
 * Supports filtering by:
 * - generationMethods (e.g., 'streaming', 'completion')
 * - promptCost (min/max range)
 * - completionCost (min/max range)
 * - thinking (boolean - models with reasoning capability)
 * - supportsImages (boolean)
 * - supportsWebSearch (boolean)
 *
 * Usage:
 * const { filteredModels, applyFilters, clearFilters } = useFilteredModels(provider)
 * applyFilters({ thinking: true, supportsImages: true })
 */
export interface ModelFilters {
  thinking?: boolean
  supportsImages?: boolean
  supportsWebSearch?: boolean
  supportsStructuredOutputs?: boolean
  promptCostMin?: number
  promptCostMax?: number
  completionCostMin?: number
  completionCostMax?: number
  contextLengthMax?: number
}

export interface ModelSortOptions {
  sortBy?: 'promptCost' | 'completionCost'
  sortOrder?: 'low-to-high' | 'high-to-low'
}

export function useFilteredModels(provider: string | null) {
  const { data: modelsData } = useModels(provider)
  const [localModels, setLocalModels] = useState<BaseModel[]>([])
  const [filters, setFilters] = useState<ModelFilters>({})
  const [sortOptions, setSortOptions] = useState<ModelSortOptions>({})
  const [favoritedModels, setFavoritedModels] = useState<string[]>(() => getFavoritedModels())

  // Sync favorites from localStorage on window focus (handles cross-tab updates)
  useEffect(() => {
    const syncFavorites = () => {
      setFavoritedModels(getFavoritedModels())
    }

    window.addEventListener('focus', syncFavorites)
    return () => {
      window.removeEventListener('focus', syncFavorites)
    }
  }, [])

  // Initialize local copy when models data changes
  useEffect(() => {
    if (modelsData?.models) {
      setLocalModels([...modelsData.models])
    }
  }, [modelsData?.models])

  // Apply filters and sorting to local copy
  const filteredModels = useMemo(() => {
    let result = localModels.filter(model => {
      // Filter by thinking capability
      if (filters.thinking !== undefined && model.thinking !== filters.thinking) {
        return false
      }

      // Filter by image support
      if (filters.supportsImages !== undefined && model.supportsImages !== filters.supportsImages) {
        return false
      }

      // Filter by web search support
      if (filters.supportsWebSearch !== undefined && model.supportsWebSearch !== filters.supportsWebSearch) {
        return false
      }

      // Filter by structured outputs support
      if (filters.supportsStructuredOutputs !== undefined && model.supportsStructuredOutputs !== filters.supportsStructuredOutputs) {
        return false
      }

      // Filter by prompt cost range
      if (filters.promptCostMin !== undefined && model.promptCost < filters.promptCostMin) {
        return false
      }
      if (filters.promptCostMax !== undefined && model.promptCost > filters.promptCostMax) {
        return false
      }

      // Filter by completion cost range
      if (filters.completionCostMin !== undefined && model.completionCost < filters.completionCostMin) {
        return false
      }
      if (filters.completionCostMax !== undefined && model.completionCost > filters.completionCostMax) {
        return false
      }

      // Filter by minimum context length requirement
      if (filters.contextLengthMax !== undefined && model.contextLength < filters.contextLengthMax) {
        return false
      }

      return true
    })

    // Apply sorting if specified
    if (sortOptions.sortBy) {
      const ascending = sortOptions.sortOrder === 'low-to-high'
      result = [...result].sort((a, b) => {
        const aVal = a[sortOptions.sortBy as keyof BaseModel]
        const bVal = b[sortOptions.sortBy as keyof BaseModel]

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return ascending ? aVal - bVal : bVal - aVal
        }

        return 0
      })
    }

    // Three-tier sorting: 1. Selected model, 2. Favorited models, 3. All others
    // This maintains the relative sorting from filters/sort options within each group
    if (modelsData?.selected) {
      const selectedName = modelsData.selected.name

      result.sort((a, b) => {
        const aIsSelected = a.name === selectedName
        const bIsSelected = b.name === selectedName
        const aIsFavorite = favoritedModels.includes(a.name)
        const bIsFavorite = favoritedModels.includes(b.name)

        // Selected model always comes first
        if (aIsSelected && !bIsSelected) return -1
        if (!aIsSelected && bIsSelected) return 1

        // Among non-selected models, favorites come before non-favorites
        if (!aIsSelected && !bIsSelected) {
          if (aIsFavorite && !bIsFavorite) return -1
          if (!aIsFavorite && bIsFavorite) return 1
        }

        // Maintain original order (from filters/sort) for models in the same tier
        return 0
      })
    }

    return result
  }, [localModels, filters, sortOptions, modelsData?.selected, favoritedModels])

  const applyFilters = useCallback((newFilters: ModelFilters) => {
    setFilters(newFilters)
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({})
    setSortOptions({})
  }, [])

  const applySorting = useCallback((sortOpts: ModelSortOptions) => {
    setSortOptions(sortOpts)
  }, [])

  const sortByField = useCallback((field: keyof BaseModel, ascending = true) => {
    setLocalModels(prev => {
      const sorted = [...prev].sort((a, b) => {
        const aVal = a[field]
        const bVal = b[field]

        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return ascending ? aVal - bVal : bVal - aVal
        }

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return ascending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
        }

        return 0
      })
      return sorted
    })
  }, [])

  return {
    filteredModels,
    allModels: localModels,
    filters,
    sortOptions,
    applyFilters,
    clearFilters,
    applySorting,
    sortByField,
    refreshFavorites: () => setFavoritedModels(getFavoritedModels()),
  }
}
