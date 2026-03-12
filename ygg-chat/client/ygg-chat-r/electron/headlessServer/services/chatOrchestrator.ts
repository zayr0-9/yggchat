import type { HeadlessMessageRequest, HeadlessStreamEvent } from '../contracts/headlessApi.js'
import { ConversationRepo } from '../persistence/conversationRepo.js'
import { MessageRepo } from '../persistence/messageRepo.js'
import { ProjectRepo } from '../persistence/projectRepo.js'
import type { ProviderTokenStore } from '../providers/tokenStore.js'
import { BranchOrchestrator, type ResolvedExecution } from './branchOrchestrator.js'
import { ProviderRouter } from './providerRouter.js'
import { ToolLoopService, type ToolExecutor } from './toolLoopService.js'

interface ChatOrchestratorDeps {
  db: any
  statements: any
  tokenStore?: ProviderTokenStore
  providerRouter?: ProviderRouter
  branchOrchestrator?: BranchOrchestrator
  toolLoopService?: ToolLoopService
  toolExecutor?: ToolExecutor
  defaultToolsProvider?: () => Array<{ name: string; description?: string; inputSchema?: Record<string, any> }>
}

export interface HeadlessChatOrchestrator {
  runMessage(request: HeadlessMessageRequest, emit: (event: HeadlessStreamEvent) => void): Promise<void>
}

export class ChatOrchestrator implements HeadlessChatOrchestrator {
  private readonly conversationRepo: ConversationRepo
  private readonly messageRepo: MessageRepo
  private readonly projectRepo: ProjectRepo
  private readonly providerRouter: ProviderRouter
  private readonly branchOrchestrator: BranchOrchestrator
  private readonly toolLoopService: ToolLoopService
  private readonly defaultToolsProvider: NonNullable<ChatOrchestratorDeps['defaultToolsProvider']>

  constructor(deps: ChatOrchestratorDeps) {
    this.conversationRepo = new ConversationRepo({ db: deps.db, statements: deps.statements })
    this.messageRepo = new MessageRepo({ db: deps.db, statements: deps.statements })
    this.projectRepo = new ProjectRepo({ db: deps.db })
    this.providerRouter = deps.providerRouter ?? new ProviderRouter({ tokenStore: deps.tokenStore })
    this.branchOrchestrator = deps.branchOrchestrator ?? new BranchOrchestrator()
    this.toolLoopService =
      deps.toolLoopService ??
      new ToolLoopService({
        messageRepo: this.messageRepo,
        providerRouter: this.providerRouter,
        executeTool: deps.toolExecutor,
      })
    this.defaultToolsProvider = deps.defaultToolsProvider ?? (() => [])
  }

  private requireMessage(messageId: string, conversationId: string): any {
    const message = this.conversationRepo.getMessageById(messageId)
    if (!message || message.conversation_id !== conversationId) {
      throw new Error(`Message not found in conversation: ${messageId}`)
    }
    return message
  }

  private createUserMessage(request: HeadlessMessageRequest, parentId: string | null, content: string): any {
    return this.messageRepo.createMessage({
      conversationId: request.conversationId,
      parentId,
      role: 'user',
      content,
      modelName: request.modelName,
      contentBlocks: null,
    })
  }

  private resolveExecution(request: HeadlessMessageRequest): ResolvedExecution {
    return this.branchOrchestrator.resolve(request, {
      requireMessage: (messageId, conversationId) => this.requireMessage(messageId, conversationId),
      createUserMessage: (parentId, content) => this.createUserMessage(request, parentId, content),
      findNearestUserAncestor: (messageId, conversationId) =>
        this.conversationRepo.findNearestUserAncestor(conversationId, messageId),
    })
  }

  async runMessage(request: HeadlessMessageRequest, emit: (event: HeadlessStreamEvent) => void): Promise<void> {
    const conversation = this.conversationRepo.getById(request.conversationId)
    if (!conversation) {
      throw new Error(`Conversation not found: ${request.conversationId}`)
    }

    const now = new Date().toISOString()
    this.conversationRepo.touch(request.conversationId, now)
    if (conversation.project_id) {
      this.projectRepo.touch(conversation.project_id, now)
    }

    const resolved = this.resolveExecution(request)

    emit({
      type: 'started',
      operation: request.operation,
      conversationId: request.conversationId,
      parentId: resolved.assistantParentId,
      provider: request.provider,
      modelName: request.modelName,
    })

    if (resolved.userMessage) {
      emit({ type: 'user_message_persisted', message: resolved.userMessage })
    }

    emit({
      type: 'provider_routed',
      provider: request.provider,
      modelName: request.modelName,
    })

    const history = this.conversationRepo.listPathToMessage(request.conversationId, resolved.historyLeafId)

    const resolvedTools =
      Array.isArray(request.tools) && request.tools.length > 0 ? request.tools : this.defaultToolsProvider()

    const project = conversation?.project_id ? this.projectRepo.getById(conversation.project_id) : null
    const systemPrompt = request.systemPrompt ?? conversation?.system_prompt ?? project?.system_prompt ?? null
    const conversationContext = request.conversationContext ?? conversation?.conversation_context ?? null
    const projectContext = request.projectContext ?? project?.context ?? null

    const toolLoopResult = await this.toolLoopService.run(
      {
        provider: request.provider,
        operation: request.operation,
        modelName: request.modelName,
        conversationId: request.conversationId,
        assistantParentId: resolved.assistantParentId,
        history,
        userContent: resolved.userContentForInference,
        systemPrompt,
        conversationContext,
        projectContext,
        think: request.think,
        temperature: request.temperature,
        userId: request.userId ?? null,
        accessToken: request.accessToken ?? null,
        accountId: request.accountId ?? null,
        attachmentsBase64: request.attachmentsBase64 ?? null,
        retrigger: request.retrigger,
        executionMode: request.executionMode ?? 'client',
        isBranch: request.isBranch ?? (request.operation === 'branch' || request.operation === 'edit-branch'),
        isElectron: request.isElectron ?? true,
        imageConfig: request.imageConfig,
        reasoningConfig: request.reasoningConfig,
        tools: resolvedTools,
        streamId: request.streamId ?? null,
        rootPath: request.rootPath ?? conversation?.cwd ?? null,
        operationMode: request.operationMode ?? 'execute',
        toolTimeoutMs: request.toolTimeoutMs,
      },
      emit
    )

    emit({ type: 'complete', message: toolLoopResult.finalAssistantMessage })
  }
}
