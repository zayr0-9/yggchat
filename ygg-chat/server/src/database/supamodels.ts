import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { BaseMessage, Project, ProjectWithLatestConversation } from '../../../shared/types'
import { stripMarkdownToText } from '../utils/markdownStripper'

// Initialize Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || ''
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/**
 * Helper to create an authenticated Supabase client from a user's JWT token
 * This allows the server to make requests on behalf of the authenticated user
 * RLS policies will automatically enforce owner_id filtering
 * auth.uid() will return the actual user UUID (not NULL)
 */
export function createAuthenticatedClient(jwt: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Admin client using service_role key - ONLY use for admin operations
 * Examples: user creation in tests, bypassing RLS for admin tasks
 * DO NOT use for regular user operations - use createAuthenticatedClient() instead
 */
export const supabaseAdmin: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

// Deprecated: Use createAuthenticatedClient() or supabaseAdmin instead
// Keeping for backward compatibility during migration
export const supabase: SupabaseClient = supabaseAdmin

// Utility function to sanitize FTS queries
function sanitizeFTSQuery(query: string): string {
  // PostgreSQL FTS uses different syntax than SQLite
  return query
    .trim()
    .split(/\s+/)
    .map(w => w.replace(/[^\w\s]/g, ''))
    .filter(w => w.length > 0)
    .join(' | ')
}

// Interfaces matching Supabase schema

export interface Profile {
  id: string // uuid
  username: string
  created_at: string
  max_credits: number
  current_credits: number
  total_spent: number
  credits_enabled: boolean
  last_reset_at?: string | null
  reset_period: 'none' | 'daily' | 'monthly' | 'yearly'
}

export interface User extends Profile {}

export interface Conversation {
  id: string // uuid
  project_id?: string | null
  owner_id: string
  title?: string | null
  model_name: string
  system_prompt?: string | null
  conversation_context?: string | null
  created_at: string
  updated_at: string
}

export interface ConversationWithProject extends Conversation {
  projects?: {
    context: string | null
    system_prompt: string | null
  } | null
}

export interface Message extends Omit<BaseMessage, 'id' | 'conversation_id' | 'parent_id'> {
  id: string // uuid
  conversation_id: string
  owner_id: string
  parent_id?: string | null
  search_vector?: any
}

export interface SearchResult extends Message {
  highlighted?: string
  highlight?: string
  conversation_title?: string
  rank?: number
}

export interface SearchResultWithSnippet extends Message {
  snippet: string
  rank?: number
}

export interface Attachment {
  id: string // uuid
  owner_id: string
  kind: 'image'
  mime_type: string
  storage: 'file' | 'url'
  storage_path?: string | null
  url?: string | null
  width?: number | null
  height?: number | null
  size_bytes?: number | null
  sha256?: string | null
  created_at: string
  message_id?: string | null // virtual field from join
}

export interface FileContent {
  id: string // uuid
  owner_id: string
  file_name: string
  relative_path: string
  content?: string | null
  size_bytes?: number | null
  created_at: string
  message_id?: string | null // virtual field from join
}

export interface ProviderCost {
  id: string // uuid
  owner_id: string
  message_id: string
  prompt_tokens: number
  completion_tokens: number
  reasoning_tokens: number
  approx_cost: number
  api_credit_cost: number
  created_at: string
}

export interface ProviderCostWithMessage {
  id: string
  owner_id: string
  message_id: string
  prompt_tokens: number
  completion_tokens: number
  reasoning_tokens: number
  approx_cost: number
  api_credit_cost: number
  created_at: string
  conversation_id: string
  role: string
  content: string
  model_name: string | null
  message_created_at: string
  conversation_title: string | null
}

// Helper to set authenticated context for RLS
function setAuthContext(userId: string) {
  // Note: With service role key, RLS is bypassed by default
  // If you want to enforce RLS, use anon key and set auth header
  return supabase.auth.admin.getUserById(userId)
}

// Update plain text content for a message
async function setPlainTextForMessage(client: SupabaseClient, text: string, id: string) {
  try {
    await client.from('messages').update({ plain_text_content: text }).eq('id', id)
  } catch {
    // ignore
  }
}

export class FileContentService {
  static async create(
    client: SupabaseClient,
    ownerId: string,
    params: {
      fileName: string
      relativePath: string
      fileContent?: string | null
      sizeBytes?: number | null
      messageId?: string | null
    }
  ): Promise<FileContent> {
    const { fileName, relativePath, fileContent = null, sizeBytes = null, messageId = null } = params

    // Check if file already exists by relative path
    const { data: existing } = await client
      .from('message_file_content')
      .select('*')
      .eq('relative_path', relativePath)
      .single()

    if (existing) {
      // Link to message if provided
      if (messageId) {
        await client
          .from('message_file_content_links')
          .insert({
            message_id: messageId,
            file_content_id: existing.id,
            owner_id: ownerId,
          })
          .select()
        return { ...existing, message_id: messageId }
      }
      return existing
    }

    const { data: created, error } = await client
      .from('message_file_content')
      .insert({
        file_name: fileName,
        relative_path: relativePath,
        content: fileContent,
        size_bytes: sizeBytes,
        owner_id: ownerId,
      })
      .select()
      .single()

    if (error) throw error

    // Create link if messageId provided
    if (messageId && created) {
      await client.from('message_file_content_links').insert({
        message_id: messageId,
        file_content_id: created.id,
        owner_id: ownerId,
      })
      return { ...created, message_id: messageId }
    }

    return created!
  }

  static async getByMessage(client: SupabaseClient, messageId: string, ownerId: string): Promise<FileContent[]> {
    const { data, error } = await client
      .from('message_file_content_links')
      .select('file_content_id, message_file_content(*)')
      .eq('message_id', messageId)
      .eq('owner_id', ownerId)

    if (error) throw error

    return (data || []).map((link: any) => ({
      ...link.message_file_content,
      message_id: messageId,
    }))
  }

  static async linkToMessage(
    client: SupabaseClient,
    fileContentId: string,
    messageId: string,
    ownerId: string
  ): Promise<FileContent | undefined> {
    await client.from('message_file_content_links').insert({
      message_id: messageId,
      file_content_id: fileContentId,
      owner_id: ownerId,
    })

    const { data } = await client.from('message_file_content').select('*').eq('id', fileContentId).single()

    return data ? { ...data, message_id: messageId } : undefined
  }

  static async findByPath(client: SupabaseClient, relativePath: string): Promise<FileContent | undefined> {
    const { data } = await client.from('message_file_content').select('*').eq('relative_path', relativePath).single()

    return data || undefined
  }

  static async getById(client: SupabaseClient, id: string): Promise<FileContent | undefined> {
    const { data } = await client.from('message_file_content').select('*').eq('id', id).single()

    return data || undefined
  }

  static async unlinkFromMessage(
    client: SupabaseClient,
    messageId: string,
    fileContentId: string,
    ownerId: string
  ): Promise<number> {
    const { count } = await client
      .from('message_file_content_links')
      .delete({ count: 'exact' })
      .eq('message_id', messageId)
      .eq('file_content_id', fileContentId)
      .eq('owner_id', ownerId)

    return count ?? 0
  }

  static async deleteByMessage(client: SupabaseClient, messageId: string, ownerId: string): Promise<number> {
    const { count } = await client
      .from('message_file_content_links')
      .delete({ count: 'exact' })
      .eq('message_id', messageId)
      .eq('owner_id', ownerId)

    return count ?? 0
  }
}

export class AttachmentService {
  static async create(
    client: SupabaseClient,
    ownerId: string,
    params: {
      messageId?: string | null
      kind: 'image'
      mimeType: string
      storage?: 'file' | 'url'
      url?: string | null
      storagePath?: string | null
      width?: number | null
      height?: number | null
      sizeBytes?: number | null
      sha256?: string | null
    }
  ): Promise<Attachment> {
    const {
      messageId = null,
      kind,
      mimeType,
      storage,
      url = null,
      storagePath = null,
      width = null,
      height = null,
      sizeBytes = null,
      sha256 = null,
    } = params

    // If sha256 provided, try to reuse existing (dedupe)
    if (sha256) {
      const { data: existing } = await client.from('message_attachments').select('*').eq('sha256', sha256).single()

      if (existing) {
        if (messageId) {
          await client.from('message_attachment_links').insert({
            message_id: messageId,
            attachment_id: existing.id,
            owner_id: ownerId,
          })
          return { ...existing, message_id: messageId }
        }
        return existing
      }
    }

    const resolvedStorage: 'file' | 'url' = storage ?? (url ? 'url' : 'file')
    const { data: created, error } = await client
      .from('message_attachments')
      .insert({
        kind,
        mime_type: mimeType,
        storage: resolvedStorage,
        url,
        storage_path: storagePath,
        width,
        height,
        size_bytes: sizeBytes,
        sha256,
        owner_id: ownerId,
      })
      .select()
      .single()

    if (error) throw error

    if (messageId && created) {
      await client.from('message_attachment_links').insert({
        message_id: messageId,
        attachment_id: created.id,
        owner_id: ownerId,
      })
      return { ...created, message_id: messageId }
    }

    return created!
  }

  static async getByMessage(client: SupabaseClient, messageId: string, ownerId: string): Promise<Attachment[]> {
    const { data, error } = await client
      .from('message_attachment_links')
      .select('attachment_id, message_attachments(*)')
      .eq('message_id', messageId)
      .eq('owner_id', ownerId)

    if (error) throw error

    return (data || []).map((link: any) => ({
      ...link.message_attachments,
      message_id: messageId,
    }))
  }

  static async linkToMessage(
    client: SupabaseClient,
    attachmentId: string,
    messageId: string,
    ownerId: string
  ): Promise<Attachment | undefined> {
    await client.from('message_attachment_links').insert({
      message_id: messageId,
      attachment_id: attachmentId,
      owner_id: ownerId,
    })

    const { data } = await client.from('message_attachments').select('*').eq('id', attachmentId).single()

    return data ? { ...data, message_id: messageId } : undefined
  }

  static async findBySha256(client: SupabaseClient, sha256: string): Promise<Attachment | undefined> {
    const { data } = await client.from('message_attachments').select('*').eq('sha256', sha256).single()

    return data || undefined
  }

  static async getById(client: SupabaseClient, id: string): Promise<Attachment | undefined> {
    const { data } = await client.from('message_attachments').select('*').eq('id', id).single()

    return data || undefined
  }

  static async unlinkFromMessage(
    client: SupabaseClient,
    messageId: string,
    attachmentId: string,
    ownerId: string
  ): Promise<number> {
    const { count } = await client
      .from('message_attachment_links')
      .delete({ count: 'exact' })
      .eq('message_id', messageId)
      .eq('attachment_id', attachmentId)
      .eq('owner_id', ownerId)

    return count ?? 0
  }

  static async deleteByMessage(client: SupabaseClient, messageId: string, ownerId: string): Promise<number> {
    const { count } = await client
      .from('message_attachment_links')
      .delete({ count: 'exact' })
      .eq('message_id', messageId)
      .eq('owner_id', ownerId)

    return count ?? 0
  }
}

export class UserService {
  static async create(username: string, id?: string): Promise<Profile> {
    const { data: created, error } = await supabase
      .from('profiles')
      .insert({ username, ...(id && { id }) })
      .select()
      .single()

    if (error) throw error
    return created!
  }

  static async getById(id: string): Promise<Profile | undefined> {
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single()
    return data || undefined
  }

  static async getByUsername(username: string): Promise<Profile | undefined> {
    const { data } = await supabase.from('profiles').select('*').eq('username', username).single()
    return data || undefined
  }

  static async getAll(): Promise<Profile[]> {
    const { data } = await supabase.from('profiles').select('*')
    return data || []
  }

  static async update(id: string, username: string): Promise<Profile | undefined> {
    const { data } = await supabase.from('profiles').update({ username }).eq('id', id).select().single()
    return data || undefined
  }

  static async delete(id: string): Promise<void> {
    await supabase.from('profiles').delete().eq('id', id)
  }
}

export class ProjectService {
  static async create(
    client: SupabaseClient,
    ownerId: string,
    name: string,
    created_at: string,
    updated_at: string,
    context: string,
    system_prompt: string
  ): Promise<Project> {
    const { data: created, error } = await client
      .from('projects')
      .insert({
        name,
        created_at,
        updated_at,
        context,
        system_prompt,
        owner_id: ownerId,
      })
      .select()
      .single()

    if (error) throw error
    return created as Project
  }

  static async getAll(client: SupabaseClient): Promise<Project[]> {
    const { data } = await client.from('projects').select('*').order('updated_at', { ascending: false })
    return (data || []) as Project[]
  }

  static async getAllSortedByLatestConversation(
    client: SupabaseClient,
    userId: string
  ): Promise<ProjectWithLatestConversation[]> {
    const { data, error } = await client.rpc('get_projects_sorted_by_latest_conversation', {
      user_id: userId,
    })

    if (error) throw error
    return (data || []) as ProjectWithLatestConversation[]
  }

  static async getById(client: SupabaseClient, id: string): Promise<Project | undefined> {
    const { data } = await client.from('projects').select('*').eq('id', id).single()
    return data ? (data as Project) : undefined
  }

  static async update(
    client: SupabaseClient,
    id: string,
    name: string,
    updated_at: string,
    context: string,
    system_prompt: string
  ): Promise<Project | undefined> {
    const { data } = await client
      .from('projects')
      .update({ name, updated_at, context, system_prompt })
      .eq('id', id)
      .select()
      .single()

    return data ? (data as Project) : undefined
  }

  static async getProjectContext(client: SupabaseClient, id: string): Promise<string | null> {
    const { data } = await client.from('projects').select('context').eq('id', id).single()

    return data?.context ?? null
  }

  static async getProjectIdFromConversation(client: SupabaseClient, conversationId: string): Promise<string | null> {
    const { data } = await client.from('conversations').select('project_id').eq('id', conversationId).single()

    return data?.project_id ?? null
  }

  static async delete(client: SupabaseClient, id: string): Promise<void> {
    await client.from('projects').delete().eq('id', id)
  }
}

export class ConversationService {
  static async create(
    client: SupabaseClient,
    ownerId: string,
    title?: string,
    modelName?: string,
    projectId?: string
  ): Promise<Conversation> {
    const { data: created, error } = await client
      .from('conversations')
      .insert({
        owner_id: ownerId,
        title: title || null,
        model_name: modelName || 'gemma3:4b',
        project_id: projectId || null,
      })
      .select()
      .single()

    if (error) throw error
    return created!
  }

  static async getByUser(client: SupabaseClient): Promise<Conversation[]> {
    console.log('🔴 [ConversationService.getByUser] CALLED')
    console.log('🔴 Stack:', new Error().stack)
    const { data } = await client.from('conversations').select('*').order('updated_at', { ascending: false })
    return data || []
  }

  static async getRecentByUser(client: SupabaseClient, limit: number): Promise<Conversation[]> {
    console.log('🔴 [ConversationService.getRecentByUser] CALLED, limit:', limit)
    console.log('🔴 Stack:', new Error().stack)
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10))
    const { data } = await client
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(safeLimit)

    return data || []
  }

  static async getByProjectId(client: SupabaseClient, id: string): Promise<Conversation[]> {
    console.log('🔴 [ConversationService.getByProjectId] CALLED, projectId:', id)
    console.log('🔴 Stack:', new Error().stack)
    const { data } = await client.from('conversations').select('*').eq('project_id', id)
    return data || []
  }

  static async getById(
    client: SupabaseClient,
    id: string,
    includeProject: boolean = false
  ): Promise<Conversation | ConversationWithProject | undefined> {
    const selectQuery = includeProject ? '*, projects(context, system_prompt)' : '*'
    const { data } = await client.from('conversations').select(selectQuery).eq('id', id).single()
    return (data || undefined) as Conversation | ConversationWithProject | undefined
  }

  static async getSystemPrompt(client: SupabaseClient, id: string): Promise<string | null> {
    const { data } = await client.from('conversations').select('system_prompt').eq('id', id).single()

    return data?.system_prompt ?? null
  }

  static async getConversationContext(client: SupabaseClient, id: string): Promise<string | null> {
    const { data } = await client.from('conversations').select('conversation_context').eq('id', id).single()

    return data?.conversation_context ?? null
  }

  static async updateSystemPrompt(
    client: SupabaseClient,
    id: string,
    prompt: string | null
  ): Promise<Conversation | undefined> {
    const { data } = await client.from('conversations').update({ system_prompt: prompt }).eq('id', id).select().single()

    return data || undefined
  }

  static async updateContext(client: SupabaseClient, id: string, context: string): Promise<Conversation | undefined> {
    const { data } = await client
      .from('conversations')
      .update({ conversation_context: context })
      .eq('id', id)
      .select()
      .single()

    return data || undefined
  }

  static async updateTitle(client: SupabaseClient, id: string, title: string): Promise<Conversation | undefined> {
    const { data } = await client.from('conversations').update({ title }).eq('id', id).select().single()

    return data || undefined
  }

  static async touch(client: SupabaseClient, id: string): Promise<void> {
    await client.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', id)
  }

  static async delete(client: SupabaseClient, id: string): Promise<void> {
    await client.from('conversations').delete().eq('id', id)
  }

  static async deleteByUser(client: SupabaseClient): Promise<void> {
    await client.from('conversations').delete()
  }

  static async clone(client: SupabaseClient, sourceConversationId: string): Promise<Conversation | undefined> {
    // Get the source conversation
    const source = await this.getById(client, sourceConversationId)
    if (!source) return undefined

    // Create new conversation with cloned title
    const cloneTitle = `${source.title || 'Conversation'} (Clone)`
    const { data: newConv, error: createError } = await client
      .from('conversations')
      .insert({
        owner_id: source.owner_id,
        title: cloneTitle,
        model_name: source.model_name,
        project_id: source.project_id,
        system_prompt: source.system_prompt,
        conversation_context: source.conversation_context,
      })
      .select()
      .single()

    if (createError || !newConv) {
      console.error('Error creating cloned conversation:', createError)
      return undefined
    }

    // Get all messages from source conversation
    const sourceMessages = await MessageService.getByConversation(client, sourceConversationId)

    // Map old message IDs to new message IDs
    const idMap = new Map<string, string>()

    // Clone messages in order, preserving tree structure
    for (const msg of sourceMessages) {
      const newParentId = msg.parent_id ? (idMap.get(msg.parent_id) ?? null) : null

      const newMsg = await MessageService.create(
        client,
        newConv.id,
        source.owner_id,
        newParentId,
        msg.role,
        msg.content,
        msg.thinking_block || '',
        msg.model_name,
        msg.tool_calls || undefined,
        msg.note || undefined
      )

      if (newMsg) {
        idMap.set(msg.id, newMsg.id)

        // Clone attachments (images) by linking to existing attachment records
        const attachments = await AttachmentService.getByMessage(client, msg.id, source.owner_id)
        for (const att of attachments) {
          await AttachmentService.linkToMessage(client, att.id, newMsg.id, source.owner_id)
        }

        // Clone file contents by linking to existing file content records
        const fileContents = await FileContentService.getByMessage(client, msg.id, source.owner_id)
        for (const fc of fileContents) {
          await FileContentService.linkToMessage(client, fc.id, newMsg.id, source.owner_id)
        }
      }
    }

    return await this.getById(client, newConv.id)
  }
}

export class MessageService {
  static async create(
    client: SupabaseClient,
    ownerId: string,
    conversationId: string,
    parentId: string | null = null,
    role: Message['role'],
    content: string,
    thinking_block: string,
    modelName?: string,
    tool_calls?: string,
    note?: string
  ): Promise<Message> {
    // Parse tool_calls safely - if invalid JSON, log and set to null
    let parsedToolCalls: any = null
    if (tool_calls) {
      try {
        console.log('🔧 [MessageService.create] Raw tool_calls string:', tool_calls)
        parsedToolCalls = JSON.parse(tool_calls)
      } catch (parseError) {
        console.error('❌ [MessageService.create] Failed to parse tool_calls JSON:', parseError)
        console.error('❌ Invalid tool_calls value:', tool_calls)
        // Continue with null - don't fail message creation
      }
    }

    console.log('inserting the following fields - - - - - - - ', {
      conversation_id: conversationId,
      owner_id: ownerId,
      parent_id: parentId,
      role,
      content,
      thinking_block,
      tool_calls: parsedToolCalls,
      model_name: modelName || 'unknown',
      note: note || null,
      plain_text_content: '',
    })
    // Compute plain text content before insert to save an API call
    let plainTextContent: string | null = null
    try {
      plainTextContent = await stripMarkdownToText(content)
    } catch {
      // If markdown stripping fails, use raw content as fallback
      plainTextContent = content
    }

    const { data: created, error } = await client
      .from('messages')
      .insert({
        conversation_id: conversationId,
        owner_id: ownerId,
        parent_id: parentId,
        role,
        content,
        thinking_block,
        tool_calls: parsedToolCalls,
        model_name: modelName || 'unknown',
        note: note || null,
        plain_text_content: plainTextContent,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating message:', error)
      throw error
    }
    console.log('created Message = = = = ', created)
    return created as Message
  }

  static async getById(client: SupabaseClient, id: string): Promise<Message | undefined> {
    const { data } = await client.from('messages').select('*').eq('id', id).single()
    return data ? (data as Message) : undefined
  }

  static async getByConversation(client: SupabaseClient, conversationId: string): Promise<Message[]> {
    const { data } = await client
      .from('messages')
      .select(
        `
        *,
        attachment_count:message_attachment_links(count),
        file_content_count:message_file_content_links(count)
      `
      )
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    return (data || []).map((r: any) => ({
      ...r,
      has_attachments: (r.attachment_count?.[0]?.count || 0) > 0,
      attachments_count: r.attachment_count?.[0]?.count || 0,
      file_content_count: r.file_content_count?.[0]?.count || 0,
    })) as Message[]
  }

  static async getMessageTree(client: SupabaseClient, conversationId: string): Promise<Message[]> {
    return this.getByConversation(client, conversationId)
  }

  static async getLastMessage(client: SupabaseClient, conversationId: string): Promise<Message | undefined> {
    const { data } = await client
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    return data ? (data as Message) : undefined
  }

  static async getChildrenIds(client: SupabaseClient, id: string): Promise<string[]> {
    const { data } = await client.from('messages').select('id').eq('parent_id', id)

    return (data || []).map((m: any) => m.id)
  }

  static async deleteByConversation(client: SupabaseClient, conversationId: string): Promise<void> {
    await client.from('messages').delete().eq('conversation_id', conversationId)
  }

  static async update(
    client: SupabaseClient,
    id: string,
    content: string,
    thinking_block: string | null = null,
    tool_calls: string | null = null,
    note: string | null = null
  ): Promise<Message | undefined> {
    const { data } = await client
      .from('messages')
      .update({
        content,
        thinking_block,
        tool_calls: tool_calls ? JSON.parse(tool_calls) : null,
        note,
      })
      .eq('id', id)
      .select()
      .single()

    // Update plain text content synchronously to avoid race conditions
    try {
      const text = await stripMarkdownToText(content)
      await setPlainTextForMessage(client, text, id)
    } catch {
      try {
        await setPlainTextForMessage(client, content, id)
      } catch {
        // Ignore plain text update failures
      }
    }

    return data ? (data as Message) : undefined
  }

  static async delete(client: SupabaseClient, id: string): Promise<boolean> {
    const { count } = await client.from('messages').delete({ count: 'exact' }).eq('id', id)
    return (count ?? 0) > 0
  }

  static async deleteMany(client: SupabaseClient, ids: string[]): Promise<number> {
    if (!ids || ids.length === 0) return 0
    const { count } = await client.from('messages').delete({ count: 'exact' }).in('id', ids)
    return count ?? 0
  }

  // Attachments helpers - keep ownerId for AttachmentService calls
  static async getAttachments(client: SupabaseClient, messageId: string, ownerId: string): Promise<Attachment[]> {
    return AttachmentService.getByMessage(client, messageId, ownerId)
  }

  static async linkAttachments(
    client: SupabaseClient,
    messageId: string,
    attachmentIds: string[],
    ownerId: string
  ): Promise<Attachment[]> {
    if (!attachmentIds || attachmentIds.length === 0) return AttachmentService.getByMessage(client, messageId, ownerId)

    for (const id of attachmentIds) {
      await AttachmentService.linkToMessage(client, id, messageId, ownerId)
    }
    return AttachmentService.getByMessage(client, messageId, ownerId)
  }

  static async unlinkAttachment(
    client: SupabaseClient,
    messageId: string,
    attachmentId: string,
    ownerId: string
  ): Promise<Attachment[]> {
    await AttachmentService.unlinkFromMessage(client, messageId, attachmentId, ownerId)
    return AttachmentService.getByMessage(client, messageId, ownerId)
  }

  // File Content helpers - keep ownerId for FileContentService calls
  static async getFileContents(client: SupabaseClient, messageId: string, ownerId: string): Promise<FileContent[]> {
    return FileContentService.getByMessage(client, messageId, ownerId)
  }

  static async linkFileContents(
    client: SupabaseClient,
    messageId: string,
    fileContentIds: string[],
    ownerId: string
  ): Promise<FileContent[]> {
    if (!fileContentIds || fileContentIds.length === 0)
      return FileContentService.getByMessage(client, messageId, ownerId)

    for (const id of fileContentIds) {
      await FileContentService.linkToMessage(client, id, messageId, ownerId)
    }
    return FileContentService.getByMessage(client, messageId, ownerId)
  }

  static async unlinkFileContent(
    client: SupabaseClient,
    messageId: string,
    fileContentId: string,
    ownerId: string
  ): Promise<FileContent[]> {
    await FileContentService.unlinkFromMessage(client, messageId, fileContentId, ownerId)
    return FileContentService.getByMessage(client, messageId, ownerId)
  }

  // Recently used model names (ordered by most recent usage)
  static async getRecentModels(client: SupabaseClient, limit: number = 5): Promise<string[]> {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 5))
    const { data } = await client
      .from('messages')
      .select('model_name, created_at')
      .not('model_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(safeLimit)

    const uniqueModels = [...new Set((data || []).map((m: any) => m.model_name).filter(Boolean))]
    return uniqueModels.slice(0, safeLimit)
  }

  // Full Text Search methods - these use RPC which respects auth.uid()
  static async searchInConversation(
    client: SupabaseClient,
    query: string,
    conversationId: string
  ): Promise<SearchResult[]> {
    const { data, error } = await client.rpc('search_messages', {
      conversation_id: conversationId,
      query_text: query,
    })

    if (error) throw error
    return (data || []) as SearchResult[]
  }

  static async searchAllUserMessages(
    client: SupabaseClient,
    query: string,
    limit: number = 50
  ): Promise<SearchResult[]> {
    const { data, error } = await client.rpc('search_all_user_messages', {
      query_text: query,
      limit_count: limit,
      offset_count: 0,
    })

    if (error) throw error
    return (data || []) as SearchResult[]
  }

  static async searchMessagesByProject(
    client: SupabaseClient,
    query: string,
    projectId: string
  ): Promise<SearchResult[]> {
    const { data, error } = await client.rpc('search_messages_by_project', {
      project_id: projectId,
      query_text: query,
    })

    if (error) throw error
    return (data || []) as SearchResult[]
  }

  static async searchWithSnippets(
    client: SupabaseClient,
    query: string,
    conversationId: string
  ): Promise<SearchResultWithSnippet[]> {
    // Use the same RPC as searchInConversation, just return with snippet (highlight)
    const { data, error } = await client.rpc('search_messages', {
      conversation_id: conversationId,
      query_text: query,
    })

    if (error) throw error
    return (data || []).map((r: any) => ({
      ...r,
      snippet: r.highlight,
    })) as SearchResultWithSnippet[]
  }

  static async searchAllUserMessagesPaginated(
    client: SupabaseClient,
    query: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<SearchResult[]> {
    const { data, error } = await client.rpc('search_all_user_messages', {
      query_text: query,
      limit_count: limit,
      offset_count: offset,
    })

    if (error) throw error
    return (data || []) as SearchResult[]
  }
}

export class ProviderCostService {
  static async create(
    client: SupabaseClient,
    params: {
      ownerId: string
      messageId: string
      promptTokens: number
      completionTokens: number
      reasoningTokens: number
      approxCost: number
      apiCreditCost: number
    }
  ): Promise<ProviderCost> {
    const { ownerId, messageId, promptTokens, completionTokens, reasoningTokens, approxCost, apiCreditCost } = params

    const { data: created, error } = await client
      .from('provider_cost')
      .insert({
        owner_id: ownerId,
        message_id: messageId,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        reasoning_tokens: reasoningTokens,
        approx_cost: approxCost,
        api_credit_cost: apiCreditCost,
      })
      .select()
      .single()

    if (error) throw error
    return created as ProviderCost
  }

  static async getByMessage(client: SupabaseClient, messageId: string): Promise<ProviderCost | undefined> {
    const { data } = await client.from('provider_cost').select('*').eq('message_id', messageId).single()

    return data ? (data as ProviderCost) : undefined
  }

  static async getByUser(client: SupabaseClient): Promise<ProviderCost[]> {
    const { data } = await client.from('provider_cost').select('*')
    return (data || []) as ProviderCost[]
  }

  static async getWithMessageByUser(client: SupabaseClient): Promise<ProviderCostWithMessage[]> {
    const { data } = await client.from('provider_cost_with_message').select('*')
    return (data || []) as ProviderCostWithMessage[]
  }

  static async getTotalsByUser(client: SupabaseClient): Promise<
    | {
        total_prompt_tokens: number
        total_completion_tokens: number
        total_reasoning_tokens: number
        total_cost_usd: number
        total_api_credits: number
      }
    | undefined
  > {
    const { data } = await client
      .from('provider_cost')
      .select('prompt_tokens, completion_tokens, reasoning_tokens, approx_cost, api_credit_cost')

    if (!data || data.length === 0) return undefined

    const totals = data.reduce(
      (acc, row) => ({
        total_prompt_tokens: acc.total_prompt_tokens + (row.prompt_tokens || 0),
        total_completion_tokens: acc.total_completion_tokens + (row.completion_tokens || 0),
        total_reasoning_tokens: acc.total_reasoning_tokens + (row.reasoning_tokens || 0),
        total_cost_usd: acc.total_cost_usd + (row.approx_cost || 0),
        total_api_credits: acc.total_api_credits + (row.api_credit_cost || 0),
      }),
      {
        total_prompt_tokens: 0,
        total_completion_tokens: 0,
        total_reasoning_tokens: 0,
        total_cost_usd: 0,
        total_api_credits: 0,
      }
    )

    return totals
  }

  static async deleteByMessage(client: SupabaseClient, messageId: string): Promise<number> {
    const { count } = await client.from('provider_cost').delete({ count: 'exact' }).eq('message_id', messageId)

    return count || 0
  }
}

// Heimdall tree format
export interface ChatNode {
  id: string
  message: string
  sender: 'user' | 'assistant'
  children: ChatNode[]
}

// Build tree structure from flat message array with parent_id
export function buildMessageTree(messages: Message[]): ChatNode | null {
  if (!messages || messages.length === 0) return null

  const messageMap = new Map<string, ChatNode>()
  const rootNodes: ChatNode[] = []

  // Create nodes
  messages.forEach(msg => {
    messageMap.set(msg.id, {
      id: msg.id.toString(),
      message: msg.content,
      sender: msg.role as 'user' | 'assistant',
      children: [],
    })
  })

  // Build tree using parent_id and collect all root nodes
  messages.forEach(msg => {
    const node = messageMap.get(msg.id)!

    if (msg.parent_id === null || msg.parent_id === undefined) {
      rootNodes.push(node)
    } else {
      const parentNode = messageMap.get(msg.parent_id)
      if (parentNode) {
        parentNode.children.push(node)
      }
    }
  })

  if (rootNodes.length === 0) return null

  // If only one root message, return it directly
  if (rootNodes.length === 1) {
    return rootNodes[0]
  }

  // Multiple roots → create a synthetic root node containing all root branches
  // This preserves all independent conversation trees
  return {
    id: 'root',
    message: 'Conversation',
    sender: 'assistant',
    children: rootNodes,
  }
}
