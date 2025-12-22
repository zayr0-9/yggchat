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

// Interfaces matching Supabase schema

export interface Profile {
  id: string // uuid
  username: string
  created_at: string
  max_credits: number
  current_credits: number
  cached_current_credits: number
  total_spent: number
  credits_enabled: boolean
  last_reset_at?: string | null
  reset_period: 'none' | 'daily' | 'monthly' | 'yearly'
  stripe_customer_id?: string | null
  active_subscription_id?: string | null
  quick_chat_project_id?: string | null
  free_generations_remaining: number
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
  research_note?: string | null
  cwd?: string | null // Working directory for Claude Code sessions
  storage_mode?: 'cloud' | 'local' // Storage location: cloud (Supabase) or local (SQLite)
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
  ex_agent_session_id?: string | null
  ex_agent_type?: string | null
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
    projectId?: string,
    systemPrompt?: string | null,
    conversationContext?: string | null,
    researchNote?: string | null
  ): Promise<Conversation> {
    const { data: created, error } = await client
      .from('conversations')
      .insert({
        owner_id: ownerId,
        title: title || null,
        model_name: modelName || 'gemma3:4b',
        project_id: projectId || null,
        system_prompt: systemPrompt || null,
        conversation_context: conversationContext || null,
        research_note: researchNote || null,
      })
      .select()
      .single()

    if (error) throw error
    return created!
  }

  static async getByUser(client: SupabaseClient): Promise<Conversation[]> {
    // console.log('🔴 [ConversationService.getByUser] CALLED')
    // console.log('🔴 Stack:', new Error().stack)
    const { data } = await client.from('conversations').select('*').order('updated_at', { ascending: false })
    return data || []
  }

  static async getRecentByUser(client: SupabaseClient, limit: number): Promise<Conversation[]> {
    // console.log('🔴 [ConversationService.getRecentByUser] CALLED, limit:', limit)
    // console.log('🔴 Stack:', new Error().stack)
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10))
    const { data } = await client
      .from('conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(safeLimit)

    return data || []
  }

  static async getResearchNotesByUser(
    client: SupabaseClient
  ): Promise<
    Array<{ id: string; title: string; research_note: string; updated_at: string; project_id: string | null }>
  > {
    const { data } = await client
      .from('conversations')
      .select('id, title, research_note, updated_at, project_id')
      .not('research_note', 'is', null)
      .neq('research_note', '')
      .order('updated_at', { ascending: false })

    // Filter out whitespace-only notes
    const filtered = data?.filter(conv => conv.research_note && conv.research_note.trim().length > 0) || []

    return filtered as Array<{
      id: string
      title: string
      research_note: string
      updated_at: string
      project_id: string | null
    }>
  }

  static async getByProjectId(client: SupabaseClient, id: string): Promise<Conversation[]> {
    // console.log('🔴 [ConversationService.getByProjectId] CALLED, projectId:', id)
    // console.log('🔴 Stack:', new Error().stack)
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

  static async updateContext(
    client: SupabaseClient,
    id: string,
    context: string | null
  ): Promise<Conversation | undefined> {
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

  static async updateResearchNote(
    client: SupabaseClient,
    id: string,
    researchNote: string | null
  ): Promise<Conversation | undefined> {
    const { data } = await client
      .from('conversations')
      .update({ research_note: researchNote })
      .eq('id', id)
      .select()
      .single()

    return data || undefined
  }

  static async updateProjectId(
    client: SupabaseClient,
    id: string,
    projectId: string | null
  ): Promise<Conversation | undefined> {
    const { data } = await client
      .from('conversations')
      .update({ project_id: projectId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

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
        research_note: source.research_note,
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
        msg.note || undefined,
        msg.content_blocks || undefined
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
    note?: string,
    content_blocks?: any[]
  ): Promise<Message> {
    // Parse tool_calls safely - if invalid JSON, log and set to null
    let parsedToolCalls: any = null
    // console.log(
    //   '📥 [MessageService.create] Received tool_calls parameter:',
    //   typeof tool_calls,
    //   'Length:',
    //   tool_calls?.length
    // )
    // console.log('📥 [MessageService.create] tool_calls value:', tool_calls)
    // console.log('📥 [MessageService.create] tool_calls is empty string?:', tool_calls === '')
    // console.log('📥 [MessageService.create] tool_calls is truthy?:', !!tool_calls)

    if (tool_calls) {
      try {
        console.log('🔧 [MessageService.create] Raw tool_calls string:', tool_calls.substring(0, 200))
        parsedToolCalls = JSON.parse(tool_calls)
        console.log(
          '✅ [MessageService.create] Successfully parsed tool_calls:',
          JSON.stringify(parsedToolCalls).substring(0, 200)
        )
      } catch (parseError) {
        console.error('❌ [MessageService.create] Failed to parse tool_calls JSON:', parseError)
        console.error('❌ Invalid tool_calls value:', tool_calls.substring(0, 200))
        // Continue with null - don't fail message creation
      }
    }
    // else {
    //   // console.log('⚠️  [MessageService.create] tool_calls is falsy, will be stored as null in database')
    // }

    // console.log('inserting the following fields - - - - - - - ', {
    //   conversation_id: conversationId,
    //   owner_id: ownerId,
    //   parent_id: parentId,
    //   role,
    //   content,
    //   thinking_block,
    //   tool_calls: parsedToolCalls,
    //   model_name: modelName || 'unknown',
    //   note: note || null,
    //   plain_text_content: '',
    // })
    // Compute plain text content before insert to save an API call
    let plainTextContent: string | null = null
    try {
      plainTextContent = await stripMarkdownToText(content)
    } catch {
      // If markdown stripping fails, use raw content as fallback
      plainTextContent = content
    }

    // console.log('💾 [MessageService.create] About to insert message with:', {
    //   role,
    //   content_length: content.length,
    //   thinking_block_length: thinking_block.length,
    //   tool_calls: parsedToolCalls,
    //   model_name: modelName || 'unknown',
    // })

    const { data: created, error } = await client
      .from('messages')
      .insert({
        conversation_id: conversationId,
        owner_id: ownerId,
        parent_id: parentId,
        role,
        content,
        thinking_block: null,
        tool_calls: null,
        model_name: modelName || 'unknown',
        note: note || null,
        plain_text_content: plainTextContent,
        content_blocks: content_blocks && content_blocks.length > 0 ? content_blocks : null,
      })
      .select()
      .single()

    if (error) {
      console.error('❌ Error creating message:', error)
      throw error
    }
    console.log('✅ [MessageService.create] Message created successfully with tool_calls:', created.tool_calls)
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
        file_content_count:message_file_content_links(count),
        attachment_links:message_attachment_links(
          attachment_id,
          message_attachments(*)
        )
      `
      )
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })

    return (data || []).map((r: any) => {
      const attachments = (r.attachment_links || []).map((link: any) => ({
        ...link.message_attachments,
        message_id: r.id,
      }))

      // Remove intermediate fields and compute counts from attachments array
      const { attachment_links, attachment_count, ...cleanedMessage } = r

      return {
        ...cleanedMessage,
        file_content_count: r.file_content_count?.[0]?.count || 0,
        attachments_count: attachments.length,
        has_attachments: attachments.length > 0,
        attachments,
      }
    }) as Message[]
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
    note: string | null = null,
    content_blocks: any = null
  ): Promise<Message | undefined> {
    // Compute plain text content before update to save an API call
    let plainTextContent: string
    try {
      plainTextContent = await stripMarkdownToText(content)
    } catch {
      // If markdown stripping fails, use raw content as fallback
      plainTextContent = content
    }

    // Build update object - only include content_blocks if provided
    const updateObj: any = {
      content,
      thinking_block,
      tool_calls: tool_calls ? JSON.parse(tool_calls) : null,
      note,
      plain_text_content: plainTextContent,
    }

    // Include content_blocks in update if provided
    if (content_blocks) {
      updateObj.content_blocks = content_blocks
    }

    // Single UPDATE query with all fields including plain_text_content
    const { data } = await client.from('messages').update(updateObj).eq('id', id).select().single()

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

// Credits and Billing Interfaces
export interface CreditLedgerEntry {
  id: string
  user_id: string
  delta_credits: number
  kind: string // ledger_entry_kind enum
  external_ref_type?: string | null
  external_ref_id?: string | null
  message_id?: string | null
  conversation_id?: string | null
  metadata?: any
  description?: string | null
  created_at: string
}

export interface Subscription {
  id: string
  user_id: string
  stripe_subscription_id: string
  stripe_customer_id: string
  stripe_price_id: string
  plan_id?: string | null
  status: string // subscription_status enum
  current_period_start: string
  current_period_end: string
  billing_cycle_anchor: string
  cancel_at_period_end: boolean
  canceled_at?: string | null
  trial_start?: string | null
  trial_end?: string | null
  metadata?: any
  created_at: string
  updated_at: string
}

export interface Plan {
  id: string
  plan_code: string
  stripe_price_id: string
  stripe_product_id?: string | null
  included_credits_per_cycle: number
  display_name: string
  display_price_usd: number
  billing_interval: string
  is_active: boolean
  metadata?: any
  created_at: string
  updated_at: string
}

export interface UserSubscriptionDetails {
  subscription_id: string
  stripe_subscription_id: string
  status: string
  plan_code: string
  plan_name: string
  monthly_credits: number
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
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

/**
 * CreditsService - Wrapper around Supabase RPC functions for credit management
 * Uses existing Supabase stored procedures for atomic credit operations
 */
export class CreditsService {
  /**
   * Get user's current credit balance
   */
  static async getUserCredits(userId: string): Promise<number> {
    try {
      const { data, error } = await supabaseAdmin.rpc('get_user_credit_balance', {
        p_user_id: userId,
      })

      if (error) throw error
      return data ?? 0
    } catch (error) {
      console.error('[CreditsService] Error getting user credits:', error)
      return 0
    }
  }

  /**
   * Check if user has sufficient credits
   */
  static async checkCreditsAvailable(
    userId: string,
    requiredAmount: number
  ): Promise<{
    hasCredits: boolean
    currentBalance: number
    required: number
    shortfall: number
  }> {
    try {
      const { data, error } = await supabaseAdmin.rpc('check_credit_availability', {
        p_user_id: userId,
        p_required_credits: requiredAmount,
      })

      if (error) throw error

      // RPC returns array with single row
      const result = Array.isArray(data) ? data[0] : data

      return {
        hasCredits: result?.has_credits ?? false,
        currentBalance: result?.current_balance ?? 0,
        required: result?.required_credits ?? requiredAmount,
        shortfall: result?.shortfall ?? requiredAmount,
      }
    } catch (error) {
      console.error('[CreditsService] Error checking credits:', error)
      return {
        hasCredits: false,
        currentBalance: 0,
        required: requiredAmount,
        shortfall: requiredAmount,
      }
    }
  }

  /**
   * Replenish user credits (for subscription allocation)
   * Sets the credit balance to the specified amount
   */
  static async replenishCredits(userId: string, creditsAmount: number, reason: string): Promise<number> {
    try {
      // Get current balance
      const currentBalance = await this.getUserCredits(userId)

      // Calculate delta to set balance to creditsAmount
      const delta = creditsAmount - currentBalance

      // Use finance_adjust_credits with 'allocation' kind
      const { data: ledgerId, error } = await supabaseAdmin.rpc('finance_adjust_credits', {
        p_user_id: userId,
        p_ref_type: 'subscription_allocation',
        p_ref_id: new Date().toISOString(), // Use timestamp as ref
        p_delta: delta,
        p_kind: 'allocation',
        p_metadata: { reason, previous_balance: currentBalance, new_balance: creditsAmount },
        p_allow_negative: false,
      })

      if (error) throw error

      // Sync cached balance
      await supabaseAdmin.rpc('sync_cached_balance', { p_user_id: userId })

      console.log(`[CreditsService] Replenished credits for user ${userId}: ${currentBalance} → ${creditsAmount}`)
      return creditsAmount
    } catch (error) {
      console.error('[CreditsService] Error replenishing credits:', error)
      throw error
    }
  }

  /**
   * Decrement user credits (for AI generation usage)
   * Returns new balance or null if insufficient credits
   */
  static async decrementCredits(userId: string, amount: number, reason: string): Promise<number | null> {
    try {
      // Check if user has sufficient credits
      const check = await this.checkCreditsAvailable(userId, amount)
      if (!check.hasCredits) {
        console.warn(
          `[CreditsService] Insufficient credits for user ${userId}. Required: ${amount}, Available: ${check.currentBalance}`
        )
        return null
      }

      // Deduct credits (negative delta)
      const { data: ledgerId, error } = await supabaseAdmin.rpc('finance_adjust_credits', {
        p_user_id: userId,
        p_ref_type: 'generation_usage',
        p_ref_id: new Date().toISOString(),
        p_delta: -amount,
        p_kind: 'usage',
        p_metadata: { reason },
        p_allow_negative: false,
      })

      if (error) throw error

      // Sync and return new balance
      const { data: newBalance } = await supabaseAdmin.rpc('sync_cached_balance', { p_user_id: userId })

      console.log(`[CreditsService] Decremented ${amount} credits for user ${userId}. New balance: ${newBalance}`)
      return newBalance ?? 0
    } catch (error: any) {
      if (error.message?.includes('Insufficient credits')) {
        console.warn(`[CreditsService] Insufficient credits for user ${userId}`)
        return null
      }
      console.error('[CreditsService] Error decrementing credits:', error)
      return null
    }
  }

  /**
   * Add credits to user balance (for bonuses, refunds, manual adjustments)
   */
  static async addCredits(userId: string, amount: number, reason: string): Promise<number> {
    try {
      const { data: ledgerId, error } = await supabaseAdmin.rpc('finance_adjust_credits', {
        p_user_id: userId,
        p_ref_type: 'manual_adjustment',
        p_ref_id: new Date().toISOString(),
        p_delta: amount,
        p_kind: 'refund', // or 'bonus' depending on reason
        p_metadata: { reason },
        p_allow_negative: false,
      })

      if (error) throw error

      // Sync and return new balance
      const { data: newBalance } = await supabaseAdmin.rpc('sync_cached_balance', { p_user_id: userId })

      console.log(`[CreditsService] Added ${amount} credits for user ${userId}. New balance: ${newBalance}`)
      return newBalance ?? amount
    } catch (error) {
      console.error('[CreditsService] Error adding credits:', error)
      throw error
    }
  }

  /**
   * Get user's credit transaction history
   */
  static async getCreditHistory(userId: string, limit: number = 100): Promise<CreditLedgerEntry[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('credits_ledger')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return (data || []) as CreditLedgerEntry[]
    } catch (error) {
      console.error('[CreditsService] Error getting credit history:', error)
      return []
    }
  }

  /**
   * Get total credits used by user (lifetime)
   */
  static async getTotalCreditsUsed(userId: string): Promise<number> {
    try {
      const { data, error } = await supabaseAdmin
        .from('credits_ledger')
        .select('delta_credits')
        .eq('user_id', userId)
        .lt('delta_credits', 0) // Only negative deltas (usage)

      if (error) throw error

      const total = (data || []).reduce((sum, entry) => sum + Math.abs(entry.delta_credits), 0)
      return total
    } catch (error) {
      console.error('[CreditsService] Error getting total credits used:', error)
      return 0
    }
  }
}

/**
 * SubscriptionService - Wrapper around Supabase RPC functions for subscription management
 * Uses existing Supabase stored procedures for subscription operations
 */
export class SubscriptionService {
  /**
   * Create or update subscription (upsert)
   * This is called from Stripe webhooks (checkout.session.completed, customer.subscription.*)
   */
  static async upsertSubscription(params: {
    userId: string
    stripeSubscriptionId: string
    stripeCustomerId: string
    stripePriceId: string
    status: string // 'active', 'canceled', 'past_due', etc.
    currentPeriodStart: Date
    currentPeriodEnd: Date
    billingCycleAnchor: Date
    cancelAtPeriodEnd?: boolean
    canceledAt?: Date | null
    trialStart?: Date | null
    trialEnd?: Date | null
    metadata?: any
  }): Promise<string> {
    try {
      const { data: subscriptionId, error } = await supabaseAdmin.rpc('handle_subscription_upsert', {
        p_user_id: params.userId,
        p_stripe_subscription_id: params.stripeSubscriptionId,
        p_stripe_customer_id: params.stripeCustomerId,
        p_stripe_price_id: params.stripePriceId,
        p_status: params.status,
        p_current_period_start: params.currentPeriodStart.toISOString(),
        p_current_period_end: params.currentPeriodEnd.toISOString(),
        p_billing_cycle_anchor: params.billingCycleAnchor.toISOString(),
        p_cancel_at_period_end: params.cancelAtPeriodEnd ?? false,
        p_canceled_at: params.canceledAt?.toISOString() ?? null,
        p_trial_start: params.trialStart?.toISOString() ?? null,
        p_trial_end: params.trialEnd?.toISOString() ?? null,
        p_metadata: params.metadata ?? {},
      })

      if (error) throw error

      console.log(
        `[SubscriptionService] Upserted subscription ${params.stripeSubscriptionId} for user ${params.userId}`
      )
      return subscriptionId
    } catch (error) {
      console.error('[SubscriptionService] Error upserting subscription:', error)
      throw error
    }
  }

  /**
   * Handle invoice payment succeeded
   * This allocates credits for the billing period
   */
  static async handleInvoicePayment(params: {
    userId: string
    stripeSubscriptionId: string
    stripeInvoiceId: string
    stripePriceId: string
    periodStart: Date
    periodEnd: Date
  }): Promise<string> {
    try {
      const { data: allocationId, error } = await supabaseAdmin.rpc('handle_invoice_payment_succeeded', {
        p_user_id: params.userId,
        p_stripe_subscription_id: params.stripeSubscriptionId,
        p_stripe_invoice_id: params.stripeInvoiceId,
        p_stripe_price_id: params.stripePriceId,
        p_period_start: params.periodStart.toISOString(),
        p_period_end: params.periodEnd.toISOString(),
      })

      if (error) throw error

      console.log(
        `[SubscriptionService] Handled invoice payment ${params.stripeInvoiceId} for user ${params.userId}, allocation: ${allocationId}`
      )
      return allocationId
    } catch (error) {
      console.error('[SubscriptionService] Error handling invoice payment:', error)
      throw error
    }
  }

  /**
   * Get user's active subscription with plan details
   */
  static async getActiveSubscription(userId: string): Promise<UserSubscriptionDetails | null> {
    try {
      const { data, error } = await supabaseAdmin.rpc('get_user_subscription', {
        p_user_id: userId,
      })

      if (error) throw error

      // RPC returns array with single row or empty array
      const result = Array.isArray(data) && data.length > 0 ? data[0] : null

      return result ? (result as UserSubscriptionDetails) : null
    } catch (error) {
      console.error('[SubscriptionService] Error getting subscription:', error)
      return null
    }
  }

  /**
   * Get plan by Stripe price ID
   */
  static async getPlanByPriceId(stripePriceId: string): Promise<Plan | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('plans')
        .select('*')
        .eq('stripe_price_id', stripePriceId)
        .eq('is_active', true)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null
        }
        throw error
      }

      return data as Plan
    } catch (error) {
      console.error('[SubscriptionService] Error getting plan by price ID:', error)
      return null
    }
  }

  /**
   * Get all active plans
   */
  static async getActivePlans(): Promise<Plan[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('plans')
        .select('*')
        .eq('is_active', true)
        .order('display_price_usd', { ascending: true })

      if (error) throw error
      return (data || []) as Plan[]
    } catch (error) {
      console.error('[SubscriptionService] Error getting active plans:', error)
      return []
    }
  }
}
