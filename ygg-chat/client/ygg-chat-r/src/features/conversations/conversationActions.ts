import { createAsyncThunk } from '@reduxjs/toolkit'
import type { BaseModel, ConversationId, ProjectId } from '../../../../../shared/types'
import { RootState } from '../../store/store'
import { ThunkExtraArgument } from '../../store/thunkExtra'
import {
  api,
  getConversationContext,
  getConversationSystemPrompt,
  patchConversationContext,
  patchConversationSystemPrompt,
  type SystemPromptPatchResponse,
} from '../../utils/api'
import { convContextSet, systemPromptSet } from './conversationSlice'
import { Conversation } from './conversationTypes'

// Fetch conversations for current user

// Fetch recently used models based on recent messages (server returns names)
export const fetchRecentModels = createAsyncThunk<
  BaseModel[],
  { limit?: number } | void,
  { extra: ThunkExtraArgument }
>('conversations/fetchRecentModels', async (args, { extra, rejectWithValue }) => {
  try {
    const { auth } = extra
    const limit = args && typeof args.limit === 'number' ? args.limit : 5
    const query = new URLSearchParams({ limit: String(limit) }).toString()
    const res = await api.get<{ models: string[] }>(`/models/recent?${query}`, auth.accessToken)
    const models = Array.isArray(res?.models) ? res.models : []
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
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to fetch recent models') as any
  }
})
export const fetchConversations = createAsyncThunk<
  Conversation[],
  void,
  { state: RootState; extra: ThunkExtraArgument }
>('conversations/fetchAll', async (_: void, { extra, rejectWithValue }) => {
  try {
    const { auth } = extra

    if (!auth.userId) {
      throw new Error('User not authenticated')
    }

    return await api.get<Conversation[]>(`/users/${auth.userId}/conversations`, auth.accessToken)
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to fetch conversations')
  }
})

// Fetch recent conversations for current user with limit
export const fetchRecentConversations = createAsyncThunk<
  Conversation[],
  { limit?: number },
  { state: RootState; extra: ThunkExtraArgument }
>('conversations/fetchRecent', async ({ limit = 10 } = {}, { extra, rejectWithValue }) => {
  try {
    const { auth } = extra

    if (!auth.userId) {
      throw new Error('User not authenticated')
    }

    const query = new URLSearchParams({ limit: String(limit) }).toString()
    return await api.get<Conversation[]>(`/users/${auth.userId}/conversations/recent?${query}`, auth.accessToken)
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to fetch recent conversations')
  }
})

// Fetch conversations by project ID
export const fetchConversationsByProjectId = createAsyncThunk<Conversation[], ProjectId, { extra: ThunkExtraArgument }>(
  'conversations/fetchByProjectId',
  async (projectId: ProjectId, { extra, rejectWithValue }) => {
    try {
      const { auth } = extra
      return await api.get<Conversation[]>(`/conversations/project/${projectId}`, auth.accessToken)
    } catch (err) {
      return rejectWithValue(err instanceof Error ? err.message : 'Failed to fetch conversations by project')
    }
  }
)

// Create new conversation for current user
export const createConversation = createAsyncThunk<
  Conversation,
  { title?: string },
  { state: RootState; extra: ThunkExtraArgument }
>('conversations/create', async ({ title }, { getState, extra, rejectWithValue }) => {
  try {
    const { auth } = extra

    if (!auth.userId) {
      throw new Error('User not authenticated')
    }

    // Get selected project ID from state
    const selectedProject = getState().projects.selectedProject
    const projectId = selectedProject?.id || null

    return await api.post<Conversation>('/conversations', auth.accessToken, {
      userId: auth.userId,
      title: title || null,
      projectId,
    })
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to create conversation')
  }
})

// Update conversation title by id
export const updateConversation = createAsyncThunk<
  Conversation,
  { id: number; title: string },
  { extra: ThunkExtraArgument }
>('conversations/update', async ({ id, title }, { extra, rejectWithValue }) => {
  try {
    const { auth } = extra
    return await api.patch<Conversation>(`/conversations/${id}/`, auth.accessToken, { title })
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to update conversation')
  }
})

// Delete conversation by id
export const deleteConversation = createAsyncThunk<
  ConversationId,
  { id: ConversationId },
  { extra: ThunkExtraArgument }
>('conversations/delete', async ({ id }, { extra, rejectWithValue }) => {
  try {
    const { auth } = extra
    await api.delete(`/conversations/${id}/`, auth.accessToken)
    return id
  } catch (err) {
    return rejectWithValue(err instanceof Error ? err.message : 'Failed to delete conversation')
  }
})

// Fetch the conversation system prompt and store in state.chat.systemPrompt
export const fetchSystemPrompt = createAsyncThunk<string | null, ConversationId, { extra: ThunkExtraArgument }>(
  'chat/fetchSystemPrompt',
  async (conversationId, { dispatch, extra, rejectWithValue }) => {
    try {
      const { auth } = extra
      const res = await getConversationSystemPrompt(conversationId, auth.accessToken)
      const value = typeof res.systemPrompt === 'string' ? res.systemPrompt : null
      dispatch(systemPromptSet(value))
      return value
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch system prompt'
      return rejectWithValue(message) as any
    }
  }
)

// Fetch conversation context
export const fetchContext = createAsyncThunk<string | null, ConversationId, { extra: ThunkExtraArgument }>(
  'chat/fetchContext',
  async (conversationId, { dispatch, extra, rejectWithValue }) => {
    try {
      const { auth } = extra
      const res = await getConversationContext(conversationId, auth.accessToken)
      const value = res.context
      // console.log('dispatching convContext ', res)
      dispatch(convContextSet(value))
      return value
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch context'
      return rejectWithValue(message) as any
    }
  }
)
// Update the conversation system prompt on the server and reflect in state
export const updateSystemPrompt = createAsyncThunk<
  SystemPromptPatchResponse,
  { id: ConversationId; systemPrompt: string | null },
  { extra: ThunkExtraArgument }
>('chat/updateSystemPrompt', async ({ id, systemPrompt }, { dispatch, extra, rejectWithValue }) => {
  try {
    const { auth } = extra
    const updated = await patchConversationSystemPrompt(id, systemPrompt, auth.accessToken)
    // Server returns updated Conversation with snake_case system_prompt
    // Mirror to client state
    dispatch(systemPromptSet((updated as any).system_prompt ?? null))
    return updated
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update system prompt'
    return rejectWithValue(message) as any
  }
})

export const updateContext = createAsyncThunk<
  { id: ConversationId; context: string | null }, // return type
  { id: ConversationId; context: string | null }, // argument type
  { extra: ThunkExtraArgument }
>('chat/updateContext', async ({ id, context }, { dispatch, extra, rejectWithValue }) => {
  try {
    const { auth } = extra
    const updated = await patchConversationContext(id, context, auth.accessToken) // ConversationPatchResponse
    const next = { id: updated.id, context: updated.conversation_context ?? null }
    dispatch(convContextSet(next.context))
    return next
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update context'
    return rejectWithValue(message) as any
  }
})
