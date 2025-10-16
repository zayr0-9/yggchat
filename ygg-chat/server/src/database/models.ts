import { BaseMessage, ConversationId, MessageId, Project, ProjectWithLatestConversation } from '../../../shared/types'
import { stripMarkdownToText } from '../utils/markdownStripper'
import { db, statements } from './db'
import { generateId } from './idGenerator'

// Utility function to sanitize FTS queries
function sanitizeFTSQuery(query: string): string {
  // Split into terms, escape double-quotes, and append * for prefix matching.
  return query
    .trim()
    .split(/\s+/)
    .map(w => w.replace(/"/g, '""')) // escape quotes
    .map(w => `${w}*`) // prefix search
    .join(' OR ') // match any token
}

// Utility function to parse children_ids from SQLite (stored as JSON string)
function parseChildrenIds(raw: any): MessageId[] {
  if (Array.isArray(raw)) return raw // Already parsed
  if (!raw) return []

  const rawStr = typeof raw === 'string' ? raw : String(raw)

  // Try JSON parse first (expected format like '["id1","id2","id3"]')
  try {
    const parsed = JSON.parse(rawStr)
    if (Array.isArray(parsed)) {
      return parsed.map(v => String(v))
    }
  } catch {
    // fall through to manual parsing
  }

  // Fallback: accept CSV with/without brackets
  const cleaned = rawStr.replace(/^\[|\]$/g, '').trim()
  if (!cleaned) return []
  return cleaned
    .split(',')
    .map(s => s.trim().replace(/^"|"$/g, ''))
    .filter(s => s.length > 0)
}

// Lazy getter for prepared statement to set plain_text_content, since tables are created at runtime
let _setPlainTextStmt: import('better-sqlite3').Statement<[string, string]> | null = null
function setPlainTextForMessage(text: string, id: string) {
  try {
    if (!_setPlainTextStmt) {
      _setPlainTextStmt = db.prepare('UPDATE messages SET plain_text_content = ? WHERE id = ?')
    }
    _setPlainTextStmt.run(text, id)
  } catch {
    // ignore
  }
}

export interface User {
  id: string
  username: string
  created_at: string
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  subscription_tier?: 'high' | 'mid' | 'low' | null
  subscription_status?: 'active' | 'canceled' | 'past_due' | null
  credits_balance?: number
  current_period_end?: string | null
}

export class FileContentService {
  /**
   * Create a file content record with file name and paths
   */
  static create(params: {
    fileName: string
    absolutePath: string
    relativePath: string
    fileContent?: string | null
    sizeBytes?: number | null
    messageId?: MessageId | null
  }): FileContent {
    const { fileName, absolutePath, relativePath, fileContent = null, sizeBytes = null, messageId = null } = params

    // Check if file already exists by absolute path
    const existing = statements.getFileContentByPath.get(absolutePath) as FileContent | undefined
    if (existing) {
      // Link to message if provided
      if (messageId) {
        statements.linkFileContentToMessage.run(messageId, existing.id)
        return { ...existing, message_id: messageId }
      }
      return existing
    }

    const id = generateId()
    statements.createFileContent.run(id, fileName, absolutePath, relativePath, fileContent, sizeBytes)
    const created = statements.getFileContentById.get(id) as FileContent

    // Create link if messageId provided
    if (messageId) {
      statements.linkFileContentToMessage.run(messageId, created.id)
      return { ...created, message_id: messageId }
    }
    return created
  }

  static getByMessage(messageId: string): FileContent[] {
    return statements.getFileContentsByMessage.all(messageId) as FileContent[]
  }

  static linkToMessage(fileContentId: string, messageId: string): FileContent | undefined {
    statements.linkFileContentToMessage.run(messageId, fileContentId)
    const base = statements.getFileContentById.get(fileContentId) as FileContent | undefined
    return base ? { ...base, message_id: messageId } : undefined
  }

  static findByPath(absolutePath: string): FileContent | undefined {
    return statements.getFileContentByPath.get(absolutePath) as FileContent | undefined
  }

  static getById(id: string): FileContent | undefined {
    return statements.getFileContentById.get(id) as FileContent | undefined
  }

  static unlinkFromMessage(messageId: string, fileContentId: string): number {
    const res = statements.unlinkFileContentFromMessage.run(messageId, fileContentId)
    return res.changes ?? 0
  }

  static deleteByMessage(messageId: string): number {
    const res = statements.deleteFileContentLinksByMessage.run(messageId)
    return res.changes ?? 0
  }
}

export class AttachmentService {
  /**
   * Create an attachment record. For local files, prefer providing filePath and optional url (if served).
   * For CDN/object storage, provide url and set storage='url'.
   * If sha256 is provided and exists, the existing record is returned (dedupe) unless messageId is provided to relink.
   */
  static create(params: {
    messageId?: MessageId | null
    kind: 'image'
    mimeType: string
    storage?: 'file' | 'url'
    url?: string | null
    filePath?: string | null
    width?: number | null
    height?: number | null
    sizeBytes?: number | null
    sha256?: string | null
  }): Attachment {
    const {
      messageId = null,
      kind,
      mimeType,
      storage,
      url = null,
      filePath = null,
      width = null,
      height = null,
      sizeBytes = null,
      sha256 = null,
    } = params

    // If sha256 provided, try to reuse existing (dedupe)
    if (sha256) {
      const existing = statements.getAttachmentBySha256.get(sha256) as Attachment | undefined
      if (existing) {
        // Link via join table if a messageId is provided
        if (messageId) {
          statements.linkAttachmentToMessage.run(messageId, existing.id)
          // Return with message context for backward compatibility
          return { ...existing, message_id: messageId }
        }
        return existing
      }
    }

    const id = generateId()
    const resolvedStorage: 'file' | 'url' = storage ?? (url ? 'url' : 'file')
    statements.createAttachment.run(
      id,
      messageId,
      kind,
      mimeType,
      resolvedStorage,
      url,
      filePath,
      width,
      height,
      sizeBytes,
      sha256
    )
    const created = statements.getAttachmentById.get(id) as Attachment
    // Create link if messageId provided
    if (messageId) {
      statements.linkAttachmentToMessage.run(messageId, created.id)
      return { ...created, message_id: messageId }
    }
    return created
  }

  static getByMessage(messageId: string): Attachment[] {
    return statements.getAttachmentsByMessage.all(messageId) as Attachment[]
  }

  static linkToMessage(attachmentId: string, messageId: MessageId): Attachment | undefined {
    statements.linkAttachmentToMessage.run(messageId, attachmentId)
    const base = statements.getAttachmentById.get(attachmentId) as Attachment | undefined
    return base ? { ...base, message_id: messageId } : undefined
  }

  static findBySha256(sha256: string): Attachment | undefined {
    return statements.getAttachmentBySha256.get(sha256) as Attachment | undefined
  }

  static getById(id: string): Attachment | undefined {
    return statements.getAttachmentById.get(id) as Attachment | undefined
  }

  static unlinkFromMessage(messageId: string, attachmentId: string): number {
    const res = statements.unlinkAttachmentFromMessage.run(messageId, attachmentId)
    return res.changes ?? 0
  }

  static deleteByMessage(messageId: string): number {
    const res = statements.deleteAttachmentsByMessage.run(messageId)
    return res.changes ?? 0
  }
}

export interface Conversation {
  id: string
  user_id: string
  project_id?: string | null
  title: string | null
  model_name: string
  system_prompt?: string | null
  conversation_context?: string | null
  created_at: string
  updated_at: string
}

export interface Message extends BaseMessage {}

// Search result interfaces
export interface SearchResult extends Message {
  highlighted: string
  conversation_title?: string
}

export interface SearchResultWithSnippet extends Message {
  snippet: string
}

// Attachments (images) associated to messages
export interface Attachment {
  id: string
  message_id: string | null
  kind: 'image'
  mime_type: string
  storage: 'file' | 'url'
  url?: string | null
  file_path?: string | null
  width?: number | null
  height?: number | null
  size_bytes?: number | null
  sha256?: string | null
  created_at: string
}

// File content associated to messages
export interface FileContent {
  id: string
  message_id?: string | null
  file_name: string
  absolute_path: string
  relative_path: string
  file_content?: string | null
  size_bytes?: number | null
  created_at: string
}

// Provider cost tracking for messages
export interface ProviderCost {
  id: string
  user_id: string
  message_id: string
  prompt_tokens: number
  completion_tokens: number
  reasoning_tokens: number
  approx_cost: number
  api_credit_cost: number
  created_at: string
}

// Provider cost with message details (from view)
export interface ProviderCostWithMessage {
  id: string
  user_id: string
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

export class UserService {
  static create(username: string): User {
    const id = generateId()
    statements.createUser.run(id, username)
    return statements.getUserById.get(id) as User
  }

  static getById(id: string): User | undefined {
    return statements.getUserById.get(id) as User | undefined
  }

  static getByUsername(username: string): User | undefined {
    return statements.getUserByUsername.get(username) as User | undefined
  }

  static getAll(): User[] {
    return statements.getAllUsers.all() as User[]
  }

  static update(id: string, username: string): User | undefined {
    statements.updateUser.run(username, id)
    return statements.getUserById.get(id) as User | undefined
  }

  static delete(id: string): void {
    statements.deleteUser.run(id)
  }
}

export class ProjectService {
  static async create(
    name: string,
    created_at: string,
    updated_at: string,
    conversation_id: string,
    context: string,
    system_prompt: string,
    user_id: string
  ): Promise<Project> {
    const id = generateId()
    statements.createProject.run(id, name, created_at, updated_at, context, system_prompt, user_id)
    return statements.getProjectById.get(id) as Project
  }

  static getAll(): Project[] {
    return statements.getAllProjects.all() as Project[]
  }

  static getAllSortedByLatestConversation(userId: string): ProjectWithLatestConversation[] {
    return statements.getProjectsSortedByLatestConversation.all(userId, userId) as ProjectWithLatestConversation[]
  }

  static getById(id: string): Project | undefined {
    return statements.getProjectById.get(id) as Project | undefined
  }

  static update(
    id: string,
    name: string,
    updated_at: string,
    context: string,
    system_prompt: string
  ): Project | undefined {
    statements.updateProject.run(name, updated_at, context, system_prompt, id)
    return statements.getProjectById.get(id) as Project | undefined
  }

  static getProjectContext(id: string): string | null {
    const row = statements.getProjectContext.get(id) as { context: string | null } | undefined
    return row?.context ?? null
  }

  static getProjectIdFromConversation(conversationId: string): string | null {
    const row = statements.getConversationProjectId.get(conversationId) as { project_id: string | null } | undefined
    return row?.project_id ?? null
  }

  static delete(id: string): void {
    statements.deleteProject.run(id)
  }
}

export class ConversationService {
  static async create(userId: string, title?: string, modelName?: string, projectId?: string): Promise<Conversation> {
    const id = generateId()
    const selectedModel = modelName || null
    statements.createConversation.run(id, userId, title, selectedModel, projectId)
    return statements.getConversationById.get(id) as Conversation
  }

  static getByUser(userId: string): Conversation[] {
    return statements.getConversationsByUser.all(userId) as Conversation[]
  }

  static getRecentByUser(userId: string, limit: number): Conversation[] {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10))
    return statements.getRecentConversationsByUser.all(userId, safeLimit) as Conversation[]
  }

  static getByProjectId(id: string): Conversation[] {
    return statements.getConversationByProjectId.all(id) as Conversation[]
  }

  static getById(id: string): Conversation | undefined {
    return statements.getConversationById.get(id) as Conversation | undefined
  }

  static getSystemPrompt(id: string): string | null {
    const row = statements.getConversationSystemPrompt.get(id) as { system_prompt: string | null } | undefined
    return row?.system_prompt ?? null
  }
  static getConversationContext(id: string): string | null {
    const row = statements.getConversationContext.get(id) as { conversation_context: string | null } | undefined
    return row?.conversation_context ?? null
  }
  static updateSystemPrompt(id: string, prompt: string | null): Conversation | undefined {
    statements.updateConversationSystemPrompt.run(prompt, id)
    return statements.getConversationById.get(id) as Conversation | undefined
  }

  static updateContext(id: string, context: string): Conversation | undefined {
    statements.updateConversationContext.run(context, id)
    return statements.getConversationById.get(id) as Conversation | undefined
  }

  static updateTitle(id: string, title: string): Conversation | undefined {
    statements.updateConversationTitle.run(title, id)
    return statements.getConversationById.get(id) as Conversation | undefined
  }

  static touch(id: string): void {
    statements.updateConversationTimestamp.run(id)
  }

  static delete(id: string): void {
    statements.deleteConversation.run(id)
  }

  static deleteByUser(userId: string): void {
    statements.deleteConversationsByUser.run(userId)
  }

  static clone(sourceConversationId: string): Conversation | undefined {
    // Get the source conversation
    const source = this.getById(sourceConversationId)
    if (!source) return undefined

    // Create new conversation with cloned title
    const cloneTitle = `${source.title || 'Conversation'} (Clone)`
    const newConvId = generateId()
    statements.createConversation.run(newConvId, source.user_id, cloneTitle, source.model_name, source.project_id)

    // Copy system prompt and context if they exist
    if (source.system_prompt) {
      statements.updateConversationSystemPrompt.run(source.system_prompt, newConvId)
    }
    if (source.conversation_context) {
      statements.updateConversationContext.run(source.conversation_context, newConvId)
    }

    // Get all messages from source conversation
    const sourceMessages = MessageService.getByConversation(sourceConversationId)

    // Map old message IDs to new message IDs
    const idMap = new Map<string, string>()

    // Clone messages in order, preserving tree structure
    for (const msg of sourceMessages) {
      const newParentId = msg.parent_id ? (idMap.get(msg.parent_id) ?? null) : null

      const newMsg = MessageService.create(
        newConvId,
        newParentId,
        msg.role,
        msg.content,
        msg.thinking_block || '',
        msg.model_name,
        msg.tool_calls || undefined,
        msg.note || undefined
      )

      const newMsgId = newMsg.id
      idMap.set(msg.id, newMsgId)

      // Clone attachments (images) by linking to existing attachment records
      const attachments = AttachmentService.getByMessage(msg.id)
      for (const att of attachments) {
        AttachmentService.linkToMessage(att.id, newMsgId)
      }

      // Clone file contents by linking to existing file content records
      const fileContents = FileContentService.getByMessage(msg.id)
      for (const fc of fileContents) {
        FileContentService.linkToMessage(fc.id, newMsgId)
      }
    }

    return this.getById(newConvId)
  }
}

export class MessageService {
  static create(
    conversationId: ConversationId,
    parentId: MessageId | null = null,
    role: Message['role'],
    content: string,
    thinking_block: string,
    modelName?: string,
    tool_calls?: string,
    note?: string
    // children: []
  ): Message {
    const id = generateId()
    statements.createMessage.run(
      id,
      conversationId,
      parentId,
      role,
      content,
      thinking_block,
      tool_calls || null,
      '[]',
      modelName,
      note || null
    )
    // Fire-and-forget: compute and persist plain text content, triggers will update FTS
    try {
      stripMarkdownToText(content)
        .then(text => {
          setPlainTextForMessage(text, id)
        })
        .catch(() => {
          // Fallback to raw content if stripping fails
          setPlainTextForMessage(content, id)
        })
    } catch {
      // ignore background plain text update errors
    }
    statements.updateConversationTimestamp.run(conversationId)
    return statements.getMessageById.get(id) as Message
  }

  static getById(id: MessageId): Message | undefined {
    const msg = statements.getMessageById.get(id) as Message | undefined
    if (!msg) return undefined
    return {
      ...msg,
      children_ids: parseChildrenIds(msg.children_ids),
    }
  }

  static getByConversation(conversationId: string): Message[] {
    const rows = statements.getMessagesByConversation.all(conversationId) as any[]
    // Normalize SQLite return types to match BaseMessage (boolean/number)
    return rows.map(r => ({
      ...r,
      children_ids: parseChildrenIds(r.children_ids),
      has_attachments:
        typeof r.has_attachments === 'number'
          ? r.has_attachments > 0
          : typeof r.has_attachments === 'string'
            ? r.has_attachments === '1' || r.has_attachments.toLowerCase() === 'true'
            : !!r.has_attachments,
      attachments_count:
        typeof r.attachments_count === 'number'
          ? r.attachments_count
          : r.attachments_count != null
            ? Number(r.attachments_count)
            : undefined,
      file_content_count:
        typeof r.file_content_count === 'number'
          ? r.file_content_count
          : r.file_content_count != null
            ? Number(r.file_content_count)
            : undefined,
    })) as Message[]
  }

  // Simple tree fetch - let frontend handle tree logic
  static getMessageTree(conversationId: string): Message[] {
    const rows = statements.getMessageTree.all(conversationId) as any[]
    return rows.map(r => ({
      ...r,
      children_ids: parseChildrenIds(r.children_ids),
    })) as Message[]
  }

  static getLastMessage(conversationId: string): Message | undefined {
    const msg = statements.getLastMessage.get(conversationId) as Message | undefined
    if (!msg) return undefined
    return {
      ...msg,
      children_ids: parseChildrenIds(msg.children_ids),
    }
  }

  static getChildrenIds(id: string): string[] {
    const row = statements.getChildrenIds.get(id) as { children_ids: string } | undefined
    const raw = row?.children_ids ?? '[]'
    // Try JSON parse first (expected format like '["id1","id2","id3"]')
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v))
      }
    } catch {
      // fall through to manual parsing
    }
    // Fallback: accept CSV with/without brackets
    const cleaned = raw.replace(/^\[|\]$/g, '').trim()
    if (!cleaned) return []
    return cleaned
      .split(',')
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(s => s.length > 0)
  }

  static deleteByConversation(conversationId: string): void {
    statements.deleteMessagesByConversation.run(conversationId)
  }

  static update(
    id: MessageId,
    content: string,
    thinking_block: string | null = null,
    tool_calls: string | null = null,
    note: string | null = null
  ): Message | undefined {
    statements.updateMessage.run(content, thinking_block, tool_calls, note, id)
    // Fire-and-forget: update plain text content
    try {
      stripMarkdownToText(content)
        .then(text => {
          setPlainTextForMessage(text, id)
        })
        .catch(() => {
          setPlainTextForMessage(content, id)
        })
    } catch {
      // ignore background plain text update errors
    }
    return statements.getMessageById.get(id) as Message | undefined
  }

  static delete(id: MessageId): boolean {
    const result = statements.deleteMessage.run(id)
    return result.changes > 0
  }

  static deleteMany(ids: string[]): number {
    if (!ids || ids.length === 0) return 0
    const res = statements.deleteMessagesByIds.run(JSON.stringify(ids))
    return res.changes ?? 0
  }

  // Attachments helpers
  static getAttachments(messageId: string): Attachment[] {
    return statements.getAttachmentsByMessage.all(messageId) as Attachment[]
  }

  static linkAttachments(messageId: string, attachmentIds: string[]): Attachment[] {
    if (!attachmentIds || attachmentIds.length === 0)
      return statements.getAttachmentsByMessage.all(messageId) as Attachment[]
    for (const id of attachmentIds) {
      statements.linkAttachmentToMessage.run(messageId, id)
    }
    return statements.getAttachmentsByMessage.all(messageId) as Attachment[]
  }

  static unlinkAttachment(messageId: string, attachmentId: string): Attachment[] {
    statements.unlinkAttachmentFromMessage.run(messageId, attachmentId)
    return statements.getAttachmentsByMessage.all(messageId) as Attachment[]
  }

  // File Content helpers
  static getFileContents(messageId: MessageId): FileContent[] {
    return statements.getFileContentsByMessage.all(messageId) as FileContent[]
  }

  static linkFileContents(messageId: string, fileContentIds: string[]): FileContent[] {
    if (!fileContentIds || fileContentIds.length === 0)
      return statements.getFileContentsByMessage.all(messageId) as FileContent[]
    for (const id of fileContentIds) {
      statements.linkFileContentToMessage.run(messageId, id)
    }
    return statements.getFileContentsByMessage.all(messageId) as FileContent[]
  }

  static unlinkFileContent(messageId: string, fileContentId: string): FileContent[] {
    statements.unlinkFileContentFromMessage.run(messageId, fileContentId)
    return statements.getFileContentsByMessage.all(messageId) as FileContent[]
  }

  // Recently used model names (ordered by most recent usage)
  static getRecentModels(limit: number = 5): string[] {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 5))
    const rows = statements.getRecentModels.all(safeLimit) as { model_name: string; last_used: string }[]
    return rows.map(r => r.model_name)
  }

  // Full Text Search methods
  static searchInConversation(query: string, conversationId: string): SearchResult[] {
    const sanitizedQuery = sanitizeFTSQuery(query)
    return statements.searchMessages.all(sanitizedQuery, conversationId) as SearchResult[]
  }

  static searchAllUserMessages(query: string, userId: string, limit: number = 50): SearchResult[] {
    const sanitizedQuery = sanitizeFTSQuery(query)
    return statements.searchAllUserMessages.all(sanitizedQuery, userId) as SearchResult[]
  }

  static searchMessagesByProject(query: string, projectId: string): SearchResult[] {
    const sanitizedQuery = sanitizeFTSQuery(query)
    return statements.searchMessagesByProject.all(sanitizedQuery, projectId) as SearchResult[]
  }

  static searchWithSnippets(query: string, conversationId: string): SearchResultWithSnippet[] {
    const sanitizedQuery = sanitizeFTSQuery(query)
    return statements.searchMessagesWithSnippet.all(sanitizedQuery, conversationId) as SearchResultWithSnippet[]
  }

  static searchAllUserMessagesPaginated(
    query: string,
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): SearchResult[] {
    const sanitizedQuery = sanitizeFTSQuery(query)
    return statements.searchAllUserMessagesPaginated.all(sanitizedQuery, userId, limit, offset) as SearchResult[]
  }
}

export class ProviderCostService {
  static create(params: {
    userId: string
    messageId: MessageId
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    approxCost: number
    apiCreditCost: number
  }): ProviderCost {
    const { userId, messageId, promptTokens, completionTokens, reasoningTokens, approxCost, apiCreditCost } = params

    const id = generateId()
    statements.createProviderCost.run(
      id,
      userId,
      messageId,
      promptTokens,
      completionTokens,
      reasoningTokens,
      approxCost,
      apiCreditCost
    )

    return {
      id,
      user_id: userId,
      message_id: messageId,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      reasoning_tokens: reasoningTokens,
      approx_cost: approxCost,
      api_credit_cost: apiCreditCost,
      created_at: new Date().toISOString(),
    }
  }

  static getByMessage(messageId: string): ProviderCost | undefined {
    return statements.getProviderCostByMessage.get(messageId) as ProviderCost | undefined
  }

  static getByUser(userId: string): ProviderCost[] {
    return statements.getProviderCostsByUser.all(userId) as ProviderCost[]
  }

  static getWithMessageByUser(userId: string): ProviderCostWithMessage[] {
    return statements.getProviderCostWithMessageByUser.all(userId) as ProviderCostWithMessage[]
  }

  static getTotalsByUser(userId: string):
    | {
        total_prompt_tokens: number
        total_completion_tokens: number
        total_reasoning_tokens: number
        total_cost_usd: number
        total_api_credits: number
      }
    | undefined {
    const result = statements.getTotalCostByUser.get(userId) as any
    if (!result) return undefined

    return {
      total_prompt_tokens: result.total_prompt_tokens || 0,
      total_completion_tokens: result.total_completion_tokens || 0,
      total_reasoning_tokens: result.total_reasoning_tokens || 0,
      total_cost_usd: result.total_cost_usd || 0,
      total_api_credits: result.total_api_credits || 0,
    }
  }

  static deleteByMessage(messageId: string): number {
    const result = statements.deleteProviderCostByMessage.run(messageId)
    return result.changes || 0
  }
}

// Heimdall tree format
export interface ChatNode {
  id: string
  message: string
  sender: 'user' | 'assistant'
  children: ChatNode[]
}

// Build tree structure from flat message array with children_ids
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

  // Build tree using children_ids and collect all root nodes
  messages.forEach(msg => {
    const node = messageMap.get(msg.id)!

    if (msg.parent_id === null) {
      rootNodes.push(node)
    }

    // Add children using children_ids array
    const childIds: MessageId[] = msg.children_ids
    childIds.forEach(childId => {
      const childNode = messageMap.get(childId)
      if (childNode) {
        node.children.push(childNode)
      }
    })
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
