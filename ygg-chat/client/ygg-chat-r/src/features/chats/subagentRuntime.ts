import type { QueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import type { RootState } from '../../store/store'
import type { OperationMode, ToolDefinition } from './chatTypes'
import { createStreamingRequest, environment, localApi } from '../../utils/api'
import { isCommunityMode } from '../../config/runtimeMode'
import { loadAgentSettings } from '../../helpers/agentSettingsStorage'
import {
  getSubagentEnabledTools,
  getSubagentMaxTurns,
  isOrchestratorEnabled,
  shouldUseGlobalAgentModelForSubagentDefault,
} from '../../helpers/subagentToolSettings'
import { getAllTools } from './toolDefinitions'

const DEFAULT_SUBAGENT_MODEL = 'openai/gpt-5.3-codex'
const isElectronEnvironment = environment === 'electron' || (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__)
const normalizeProviderSlug = (providerName: string | null | undefined): string =>
  (providerName || '').toLowerCase().replace(/\s+/g, '')

export interface SubagentRuntimeContext {
  dispatch: any
  getState: () => RootState
  conversationId: string
  parentMessageId: string
  streamId?: string
  rootPath: string | null
  callerProvider?: string | null
  queryClient?: QueryClient | null
  executeLocalTool: (
    toolCall: any,
    rootPath: string | null,
    operationMode: OperationMode,
    context?: {
      conversationId?: string
      messageId?: string
      streamId?: string
      priority?: 'low' | 'normal' | 'high' | 'critical'
      timeoutMs?: number
      accessToken?: string | null
      callerProvider?: string | null
      queryClient?: QueryClient | null
      dispatch?: any
      getState?: () => RootState
    }
  ) => Promise<string>
  executeToolWithPermissionCheck: (
    dispatch: any,
    getState: any,
    toolCall: any,
    rootPath: string | null,
    operationMode: OperationMode,
    context?: {
      conversationId?: string
      messageId?: string
      streamId?: string
      priority?: 'low' | 'normal' | 'high' | 'critical'
      timeoutMs?: number
      accessToken?: string | null
      queryClient?: QueryClient | null
      enableHooks?: boolean
      provider?: string | null
      model?: string | null
      operation?: 'send' | 'branch' | 'edit-branch'
      onHookAdditionalContext?: (value: string) => void
    }
  ) => Promise<string>
}

export type SubagentInheritedProvider = 'openaichatgpt' | 'openrouter' | 'lmstudio' | 'zai' | 'bedrock'

const resolveInheritedSubagentProvider = (
  callerProviderName: string | null | undefined
): SubagentInheritedProvider | undefined => {
  const slug = normalizeProviderSlug(callerProviderName)
  if (slug === 'openaichatgpt' || slug === 'openai(chatgpt)') return 'openaichatgpt'
  if (slug === 'openrouter') return 'openrouter'
  if (slug === 'lmstudio') return 'lmstudio'
  if (slug === 'zai' || slug === 'z.ai' || slug === 'glm') return 'zai'
  if (slug === 'bedrock' || slug === 'awsbedrock' || slug === 'aws-bedrock' || slug === 'amazonbedrock' || slug === 'amazon-bedrock') return 'bedrock'
  return undefined
}

const resolveSubagentDefaults = async (
  requestedModel: unknown,
  callerProviderName?: string | null
): Promise<{ model: string; provider?: SubagentInheritedProvider }> => {
  const normalizedRequestedModel = typeof requestedModel === 'string' ? requestedModel.trim() : ''

  let defaultModel = DEFAULT_SUBAGENT_MODEL
  if (shouldUseGlobalAgentModelForSubagentDefault()) {
    try {
      const agentSettings = await loadAgentSettings()
      if (typeof agentSettings.model === 'string' && agentSettings.model.trim().length > 0) {
        defaultModel = agentSettings.model.trim()
      }
    } catch (error) {
      console.warn('[subagent] Failed to load global agent model for defaulting:', error)
    }
  }

  return {
    model: normalizedRequestedModel || defaultModel,
    provider: resolveInheritedSubagentProvider(callerProviderName),
  }
}

const shouldUseCommunityLocalEphemeral = () => isCommunityMode && isElectronEnvironment

const parseToolResultsFromContentBlocks = (contentBlocks: any): any[] => {
  if (!Array.isArray(contentBlocks)) return []

  return contentBlocks
    .filter(block => block?.type === 'tool_result' && (block?.tool_use_id || block?.toolUseId))
    .map(block => ({
      tool_use_id: block.tool_use_id || block.toolUseId,
      content:
        typeof block.content === 'string' ? block.content : block.content == null ? '' : JSON.stringify(block.content),
      is_error: Boolean(block.is_error ?? block.isError),
      tool_name: typeof block.name === 'string' ? block.name : undefined,
      input: block.input,
    }))
}

/**
 * Simple subagent execution without tool calling (fallback when context not available)
 */
export const executeSimpleSubagentCall = async (
  toolCall: any,
  accessToken: string | null,
  callerProviderName?: string | null
): Promise<string> => {
  const args = toolCall.arguments || {}
  const { prompt, model, systemPrompt, maxTokens, temperature, response_format, responseFormat } = args
  const effectiveResponseFormat = response_format ?? responseFormat

  if (!prompt) {
    throw new Error('Subagent requires a prompt')
  }

  const { model: resolvedModel, provider: resolvedProvider } = await resolveSubagentDefaults(model, callerProviderName)

  try {
    if (shouldUseCommunityLocalEphemeral()) {
      const localPayload = await localApi.post<any>('/headless/ephemeral/chat', {
        prompt,
        provider: resolvedProvider,
        model: resolvedModel,
        maxTokens,
        temperature: temperature ?? 0.7,
        systemPrompt,
        response_format: effectiveResponseFormat,
      })

      if (!localPayload?.success) {
        throw new Error(localPayload?.error || 'Community local subagent generation failed')
      }

      const fullText = typeof localPayload?.message?.content === 'string' ? localPayload.message.content : ''
      const reasoning = typeof localPayload?.reasoning === 'string' ? localPayload.reasoning : ''

      if (reasoning) {
        return `<thinking>\n${reasoning}\n</thinking>\n\n${fullText}`
      }
      return fullText || 'Subagent returned empty response'
    }
    const response = await createStreamingRequest('/generate/ephemeral', accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        provider: resolvedProvider,
        model: resolvedModel,
        maxTokens,
        temperature: temperature ?? 0.7,
        systemPrompt,
        response_format: effectiveResponseFormat,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Subagent generation failed: HTTP ${response.status}: ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body from subagent')
    }

    const decoder = new TextDecoder()
    let fullText = ''
    let reasoning = ''
    let sseBuffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      sseBuffer += chunk

      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.text) {
              fullText += parsed.text
            } else if (parsed.reasoning) {
              reasoning += parsed.reasoning
            }
          } catch {
            if (data.trim()) {
              fullText += data
            }
          }
        }
      }
    }

    if (reasoning) {
      return `<thinking>\n${reasoning}\n</thinking>\n\n${fullText}`
    }
    return fullText || 'Subagent returned empty response'
  } catch (error) {
    console.error('[executeSimpleSubagentCall] Error:', error)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Convert ToolDefinition to server's expected format for openrouter
 * Server expects: { name, enabled, description, inputSchema }
 */
const convertToServerToolFormat = (tool: ToolDefinition) => ({
  name: tool.name,
  enabled: true, // Tools sent to subagent are explicitly enabled
  description: tool.description || '',
  inputSchema: tool.inputSchema || { type: 'object', properties: {} },
})

const subagentAbortControllersByStream = new Map<string, Set<AbortController>>()

export const registerSubagentAbortController = (streamId: string | null | undefined, controller: AbortController) => {
  if (!streamId) return () => {}
  let controllers = subagentAbortControllersByStream.get(streamId)
  if (!controllers) {
    controllers = new Set()
    subagentAbortControllersByStream.set(streamId, controllers)
  }
  controllers.add(controller)
  return () => {
    const set = subagentAbortControllersByStream.get(streamId)
    if (!set) return
    set.delete(controller)
    if (set.size === 0) subagentAbortControllersByStream.delete(streamId)
  }
}

export const abortSubagentControllers = (streamId?: string | null) => {
  if (streamId) {
    const controllers = subagentAbortControllersByStream.get(streamId)
    if (controllers) {
      controllers.forEach(controller => controller.abort())
      subagentAbortControllersByStream.delete(streamId)
    }
    return
  }

  for (const controllers of subagentAbortControllersByStream.values()) {
    controllers.forEach(controller => controller.abort())
  }
  subagentAbortControllersByStream.clear()
}

/**
 * Get filtered tool definitions for subagent based on mode
 * Returns tools in server's expected format: { name, enabled, description, inputSchema }
 */

type SubagentRunRecord = {
  id: string
  conversation_id?: string
  parent_message_id?: string
  messages?: any[]
}

const createSubagentRun = async (input: {
  id: string
  conversationId: string
  parentMessageId: string
  toolCallId?: string | null
  prompt: string
  provider?: string | null
  modelName?: string | null
  systemPrompt?: string | null
}): Promise<SubagentRunRecord | null> => {
  try {
    const result = await localApi.post<{ run: SubagentRunRecord }>('/subagents/runs', {
      id: input.id,
      conversation_id: input.conversationId,
      parent_message_id: input.parentMessageId,
      tool_call_id: input.toolCallId || null,
      prompt: input.prompt,
      provider: input.provider || null,
      model_name: input.modelName || null,
      system_prompt: input.systemPrompt || null,
      status: 'running',
    })
    return result?.run || null
  } catch (error) {
    console.warn('[subagent] Failed to create subagent run:', error)
    return null
  }
}

const appendSubagentMessage = async (
  runId: string | null,
  message: {
    id?: string
    role: 'user' | 'assistant' | 'tool' | 'system'
    content?: string
    thinking_block?: string | null
    tool_calls?: any[] | null
    tool_call_id?: string | null
    content_blocks?: any[] | null
    sequence?: number
  }
) => {
  if (!runId) return
  try {
    await localApi.post(`/subagents/runs/${runId}/messages`, message)
  } catch (error) {
    console.warn('[subagent] Failed to append subagent transcript message:', error)
  }
}

const updateSubagentRun = async (
  runId: string | null,
  patch: {
    status?: 'running' | 'completed' | 'error' | 'aborted'
    final_response?: string | null
    error?: string | null
    turns_used?: number
    tool_calls_used?: number
  }
) => {
  if (!runId) return
  try {
    await localApi.patch(`/subagents/runs/${runId}`, patch)
  } catch (error) {
    console.warn('[subagent] Failed to update subagent run:', error)
  }
}

const getSubagentToolDefinitions = (
  orchestratorMode: boolean,
  requestedTools: string[] | undefined
): Array<{ name: string; enabled: boolean; description: string; inputSchema: any }> => {
  // Check if orchestrator is globally enabled
  if (!isOrchestratorEnabled()) {
    // Orchestrator disabled - subagent cannot use any tools
    return []
  }

  const allTools = getAllTools()

  // Always exclude 'subagent' to prevent recursion
  const excludedTools = new Set(['subagent'])

  let allowedToolNames: Set<string>

  if (orchestratorMode && requestedTools?.length) {
    // Orchestrator mode: use requested tools (intersection with available)
    allowedToolNames = new Set(requestedTools.filter(name => !excludedTools.has(name)))
  } else {
    // Pre-configured mode: use localStorage settings
    const configuredTools = getSubagentEnabledTools()
    allowedToolNames = new Set(configuredTools.filter(name => !excludedTools.has(name)))
  }

  // Filter and convert to OpenAI format
  // When orchestratorMode=true with explicit requestedTools, bypass the t.enabled check
  // This allows the model to request any tool regardless of global enabled state
  const bypassEnabledCheck = !!(orchestratorMode && requestedTools?.length)

  return allTools
    .filter(t => {
      const passesEnabledCheck = bypassEnabledCheck ? true : t.enabled
      return passesEnabledCheck && allowedToolNames.has(t.name) && !excludedTools.has(t.name)
    })
    .map(convertToServerToolFormat)
}

/**
 * Execute subagent tool with full agentic capabilities.
 * Supports multi-turn tool execution, message persistence, and configurable tool access.
 */
export const executeSubagentCall = async (
  toolCall: any,
  accessToken: string | null,
  context: SubagentRuntimeContext
): Promise<string> => {
  const args = toolCall.arguments || {}
  const {
    prompt,
    model,
    systemPrompt,
    maxTokens,
    temperature,
    response_format,
    responseFormat,
    orchestratorMode = false,
    tools: requestedTools,
    inheritAutoApprove = true,
    sessionId,
    resume = false,
  } = args
  const effectiveResponseFormat = response_format ?? responseFormat

  if (!prompt) {
    throw new Error('Subagent requires a prompt')
  }

  const { dispatch, getState, conversationId, parentMessageId, rootPath } = context
  const streamId = context.streamId
  const state = getState()
  const callerProviderName = context.callerProvider ?? state.chat.providerState.currentProvider
  const { model: resolvedModel, provider: resolvedProvider } = await resolveSubagentDefaults(model, callerProviderName)

  // Get filtered tool definitions for this subagent
  const subagentTools = getSubagentToolDefinitions(orchestratorMode, requestedTools)

  const requestedSessionId = typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : null
  const shouldResume = resume === true && !!requestedSessionId
  const subagentSessionId = shouldResume ? requestedSessionId! : uuidv4()
  let hadAnyToolActivity = false
  let turnsUsed = 0
  let toolCallsUsed = 0

  // Subagent transcripts are stored outside the main chat tree. Resume against
  // legacy message-cache lineage is intentionally disabled until dedicated run
  // resume endpoints are wired for this protocol.
  if (shouldResume) {
    throw new Error('Subagent resume is not available with dedicated transcript storage yet.')
  }

  const conversationHistory: any[] = [{ role: 'user', content: prompt }]

  await createSubagentRun({
    id: subagentSessionId,
    conversationId,
    parentMessageId,
    toolCallId: typeof toolCall?.id === 'string' ? toolCall.id : null,
    prompt,
    provider: resolvedProvider || null,
    modelName: resolvedModel,
    systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : null,
  })
  await appendSubagentMessage(subagentSessionId, {
    role: 'user',
    content: prompt,
    content_blocks: [{ type: 'text', content: prompt, subagent_role: 'user_prompt' }],
  })

  let finalResponse = ''
  
  const subagentAbortController = new AbortController()
  const unregisterAbortController = registerSubagentAbortController(streamId, subagentAbortController)
  const isStreamActive = () => {
    if (!streamId) return true
    return getState().chat.streaming.byId[streamId]?.active ?? false
  }

  // Agentic loop with user-configurable hard limit
  const subagentMaxTurns = getSubagentMaxTurns()
  let shouldContinue = true
  try {
    for (let turn = 0; turn < subagentMaxTurns && shouldContinue; turn++) {
      if (!isStreamActive()) {
        subagentAbortController.abort()
        throw new Error('Subagent aborted')
      }

      // Call ephemeral endpoint with tools and conversation history
      const requestBody = {
        messages: conversationHistory,
        provider: resolvedProvider,
        model: resolvedModel,
        maxTokens,
        temperature: temperature ?? 0.7,
        systemPrompt,
        response_format: effectiveResponseFormat,
        tools: subagentTools.length > 0 ? subagentTools : undefined,
      }

      let response: Response
      if (shouldUseCommunityLocalEphemeral()) {
        const localPayload = await localApi.post<any>('/headless/ephemeral/chat', requestBody)
        if (!localPayload?.success) {
          throw new Error(localPayload?.error || 'Community local subagent generation failed')
        }

        const syntheticEvents: string[] = []
        if (typeof localPayload?.reasoning === 'string' && localPayload.reasoning.length > 0) {
          syntheticEvents.push(
            `data: ${JSON.stringify({ type: 'chunk', part: 'reasoning', delta: localPayload.reasoning })}`
          )
        }
        if (typeof localPayload?.message?.content === 'string' && localPayload.message.content.length > 0) {
          syntheticEvents.push(
            `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: localPayload.message.content })}`
          )
        }

        const localToolCalls = Array.isArray(localPayload?.toolCalls) ? localPayload.toolCalls : []
        for (const toolCall of localToolCalls) {
          syntheticEvents.push(`data: ${JSON.stringify({ type: 'tool_call', toolCall })}`)
        }

        const localToolResults = parseToolResultsFromContentBlocks(localPayload?.contentBlocks)
        for (const toolResult of localToolResults) {
          syntheticEvents.push(`data: ${JSON.stringify({ type: 'tool_result', toolResult })}`)
        }

        syntheticEvents.push('data: [DONE]')
        response = new Response(`${syntheticEvents.join('\n')}\n`, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      } else {
        response = await createStreamingRequest('/generate/ephemeral', accessToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: subagentAbortController.signal,
        })
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Subagent generation failed: HTTP ${response.status}: ${errorText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body from subagent')
      }

      const decoder = new TextDecoder()
      let turnText = ''
      let turnReasoning = ''
      const turnToolCalls: any[] = []
      const serverToolResults: any[] = [] // Track tool results from server-executed tools (e.g., brave_search)
      const seenToolCallIds = new Set<string>()
      const seenToolResultIds = new Set<string>()
      let sseBuffer = ''

      const appendText = (value?: any) => {
        if (typeof value === 'string' && value.length > 0) {
          turnText += value
        }
      }

      const appendReasoning = (value?: any) => {
        if (typeof value === 'string' && value.length > 0) {
          turnReasoning += value
        }
      }

      const addToolCall = (toolCall?: any) => {
        if (!toolCall) return
        if (toolCall.id && seenToolCallIds.has(toolCall.id)) return
        if (toolCall.id) seenToolCallIds.add(toolCall.id)
        turnToolCalls.push(toolCall)
      }

      const addToolResult = (toolResult?: any) => {
        if (!toolResult) return
        if (toolResult.tool_use_id && seenToolResultIds.has(toolResult.tool_use_id)) return
        if (toolResult.tool_use_id) seenToolResultIds.add(toolResult.tool_use_id)
        serverToolResults.push(toolResult)
      }

      const buildContentBlocks = (toolResults: any[], includeToolUsesForResults = false) => {
        const blocks: any[] = []
        if (turnReasoning) {
          blocks.push({ type: 'thinking', content: turnReasoning })
        }
        if (turnText) {
          blocks.push({ type: 'text', content: turnText })
        }
        for (const tc of turnToolCalls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments || tc.input })
        }
        if (includeToolUsesForResults && toolResults.length > 0) {
          const existingToolUseIds = new Set(turnToolCalls.map(tc => tc.id))
          for (const tr of toolResults) {
            if (tr?.tool_use_id && !existingToolUseIds.has(tr.tool_use_id) && tr.tool_name) {
              blocks.push({
                type: 'tool_use',
                id: tr.tool_use_id,
                name: tr.tool_name,
                input: tr.input ?? tr.args ?? tr.arguments,
              })
            }
          }
        }
        for (const tr of toolResults) {
          blocks.push({
            type: 'tool_result',
            tool_use_id: tr.tool_use_id,
            content: tr.content,
            is_error: tr.is_error,
          })
        }
        return blocks
      }

      // Parse SSE stream
      while (true) {
        if (!isStreamActive()) {
          subagentAbortController.abort()
          throw new Error('Subagent aborted')
        }

        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        sseBuffer += chunk

        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed?.type === 'chunk' && parsed?.part) {
                if (parsed.part === 'text') {
                  appendText(parsed.delta ?? parsed.content ?? parsed.text)
                } else if (parsed.part === 'reasoning') {
                  appendReasoning(parsed.delta ?? parsed.reasoning)
                } else if (parsed.part === 'tool_call') {
                  addToolCall(parsed.toolCall)
                } else if (parsed.part === 'tool_result') {
                  addToolResult(parsed.toolResult)
                }
              } else if (parsed?.type === 'tool_call') {
                addToolCall(parsed.toolCall || parsed.tool_call || parsed)
              } else if (parsed?.type === 'tool_result') {
                addToolResult(parsed.toolResult || parsed.tool_result || parsed)
              } else if (parsed?.toolCall) {
                addToolCall(parsed.toolCall)
              } else if (parsed?.toolResult) {
                // Server executed a server-only tool (e.g., brave_search)
                addToolResult(parsed.toolResult)
              } else if (parsed?.reasoning) {
                appendReasoning(parsed.reasoning)
              } else if (parsed?.text) {
                appendText(parsed.text)
              } else if (parsed?.delta) {
                appendText(parsed.delta)
              } else if (parsed?.content) {
                appendText(parsed.content)
              }
            } catch {
              if (data.trim()) {
                turnText += data
              }
            }
          }
        }
      }

      // Create assistant message for this turn
      const assistantMessageId = uuidv4()
      const assistantMessage: any = {
        id: assistantMessageId,
        role: 'assistant',
        content: turnText,
        tool_calls: turnToolCalls.length > 0 ? turnToolCalls : null,
        thinking_block: turnReasoning || null,
      }
      turnsUsed = turn + 1

      // If no client tool calls AND no server tool results, this is the final response
      if (turnToolCalls.length === 0 && serverToolResults.length === 0) {
        finalResponse = turnReasoning ? `<thinking>\n${turnReasoning}\n</thinking>\n\n${turnText}` : turnText

        // Build content_blocks for final message (text only, no tool calls/results)
        const finalContentBlocks = buildContentBlocks([])
        assistantMessage.content_blocks = finalContentBlocks

        await appendSubagentMessage(subagentSessionId, {
          id: assistantMessageId,
          role: 'assistant',
          content: turnText,
          thinking_block: turnReasoning || null,
          tool_calls: turnToolCalls.length > 0 ? turnToolCalls : null,
          content_blocks: finalContentBlocks,
        })
        await updateSubagentRun(subagentSessionId, {
          status: 'completed',
          final_response: finalResponse,
          turns_used: turnsUsed,
          tool_calls_used: toolCallsUsed,
        })
        break
      }

      // If server executed tools (e.g., brave_search) but no client tools needed,
      // we need to add the server results to conversation history and continue the loop
      // so the model can process the results
      if (turnToolCalls.length === 0 && serverToolResults.length > 0) {
        const contentBlocks = buildContentBlocks(serverToolResults, true)
        assistantMessage.content_blocks = contentBlocks

        await appendSubagentMessage(subagentSessionId, {
          id: assistantMessageId,
          role: 'assistant',
          content: turnText,
          thinking_block: turnReasoning || null,
          tool_calls: turnToolCalls.length > 0 ? turnToolCalls : null,
          content_blocks: contentBlocks,
        })

        if (turnText || turnReasoning) {
          conversationHistory.push({
            role: 'assistant',
            content: turnText || '',
          })
        }

        hadAnyToolActivity = hadAnyToolActivity || serverToolResults.length > 0

        // Add server tool results to conversation history
        // The server already added the assistant message with tool_calls and executed them
        // We just need to add the tool results so the model can continue
        for (const tr of serverToolResults) {
          conversationHistory.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: tr.content,
          })
        }

          finalResponse = turnText

        // Continue to next turn - model will process the tool results
        continue
      }

      // Process client tool calls
      const toolResults: any[] = []

      // Build a set of tool IDs that were already executed by the server
      const serverExecutedToolIds = new Set(serverToolResults.map(tr => tr.tool_use_id))
      hadAnyToolActivity = hadAnyToolActivity || serverToolResults.length > 0

      // Filter out tool calls that were already executed by the server
      const clientToolCalls = turnToolCalls.filter(tc => !serverExecutedToolIds.has(tc.id))

      for (let i = 0; i < clientToolCalls.length; i++) {
        const tc = clientToolCalls[i]

        // Skip nested subagent calls
        if (tc.name === 'subagent') {
          toolResults.push({
            tool_use_id: tc.id,
            content: 'Error: Nested subagent calls are not allowed.',
            is_error: true,
          })
          hadAnyToolActivity = true
          continue
        }

        try {
          // Read live settings per tool call so toggles apply mid-stream.
          const liveState = getState()
          const parentAutoApprove = liveState.chat.toolAutoApprove
          const liveOperationMode = liveState.chat.operationMode
          const shouldAutoApprove = inheritAutoApprove && parentAutoApprove

          let result: string
          if (shouldAutoApprove) {
            // Execute directly without permission check
            result = await context.executeLocalTool(tc, rootPath, liveOperationMode, {
              conversationId,
              messageId: assistantMessageId,
              accessToken,
              queryClient: context.queryClient ?? null,
            })
          } else {
            // Show permission dialog
            result = await context.executeToolWithPermissionCheck(dispatch, getState, tc, rootPath, liveOperationMode, {
              conversationId,
              messageId: assistantMessageId,
              accessToken,
              queryClient: context.queryClient ?? null,
            })
          }

          toolResults.push({
            tool_use_id: tc.id,
            content: result,
            is_error: false,
          })
          hadAnyToolActivity = true
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          toolResults.push({
            tool_use_id: tc.id,
            content: `Error: ${errorMsg}`,
            is_error: true,
          })
          hadAnyToolActivity = true
        }
      }

      // Combine all tool results (server-executed + client-executed)
      const allToolResults = [...serverToolResults, ...toolResults]
      toolCallsUsed += allToolResults.length

      // Build content_blocks with tool results
      const contentBlocks = buildContentBlocks(allToolResults)
      assistantMessage.content_blocks = contentBlocks

      // Persist assistant transcript turn outside the main chat tree.
      await appendSubagentMessage(subagentSessionId, {
        id: assistantMessageId,
        role: 'assistant',
        content: turnText,
        thinking_block: turnReasoning || null,
        tool_calls: turnToolCalls.length > 0 ? turnToolCalls : null,
        content_blocks: contentBlocks,
      })

      // Add assistant message with tool_calls to conversation history
      const toolCallsForHistory = turnToolCalls
        .map(tc => ({
          id: tc?.id,
          type: 'function',
          function: {
            name:
              typeof tc?.name === 'string' ? tc.name : typeof tc?.function?.name === 'string' ? tc.function.name : '',
            arguments: JSON.stringify(tc.arguments || tc.input || tc?.function?.arguments || {}),
          },
        }))
        .filter(
          (tc): tc is { id: string; type: 'function'; function: { name: string; arguments: string } } =>
            typeof tc.id === 'string' &&
            tc.id.length > 0 &&
            typeof tc.function.name === 'string' &&
            tc.function.name.length > 0
        )

      conversationHistory.push({
        role: 'assistant',
        content: turnText || '',
        tool_calls: toolCallsForHistory,
      })

      // Add each tool result as a separate 'tool' message (same format as createToolResultMessage)
      // Include both server-executed and client-executed tool results
      for (const tr of allToolResults) {
        conversationHistory.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: tr.content,
        })
      }

      finalResponse = turnText
    }
  } catch (error) {
    if (subagentAbortController.signal.aborted) {
      await updateSubagentRun(subagentSessionId, { status: 'aborted', error: 'Subagent aborted', turns_used: turnsUsed, tool_calls_used: toolCallsUsed })
      throw new Error('Subagent aborted')
    }
    console.error('[subagent] Error in subagent execution:', error)
    await updateSubagentRun(subagentSessionId, {
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      turns_used: turnsUsed,
      tool_calls_used: toolCallsUsed,
    })
    throw error
  } finally {
    unregisterAbortController()
  }

  // Deterministic finalization: if tools ran but no text response, force one more turn
  const hasFinalText = typeof finalResponse === 'string' && finalResponse.trim().length > 0

  if (hadAnyToolActivity && !hasFinalText && !subagentAbortController.signal.aborted) {
    if (!isStreamActive()) {
      subagentAbortController.abort()
      throw new Error('Subagent aborted')
    }

    // Append a finalization instruction in subagent-only context
    conversationHistory.push({
      role: 'user',
      content:
        'Summarize the tool results above and provide the final answer. Do not call tools. Be concise and complete.',
    })

    const finalizeRequestBody = {
      messages: conversationHistory,
      provider: resolvedProvider,
      model: resolvedModel,
      maxTokens,
      temperature: temperature ?? 0.3,
      systemPrompt,
      tools: undefined, // Force no tool calls for finalization
    }

    let finalizeResponse: Response
    if (shouldUseCommunityLocalEphemeral()) {
      const localPayload = await localApi.post<any>('/headless/ephemeral/chat', finalizeRequestBody)
      if (!localPayload?.success) {
        throw new Error(localPayload?.error || 'Community local subagent finalization failed')
      }

      const syntheticEvents: string[] = []
      if (typeof localPayload?.reasoning === 'string' && localPayload.reasoning.length > 0) {
        syntheticEvents.push(
          `data: ${JSON.stringify({ type: 'chunk', part: 'reasoning', delta: localPayload.reasoning })}`
        )
      }
      if (typeof localPayload?.message?.content === 'string' && localPayload.message.content.length > 0) {
        syntheticEvents.push(
          `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: localPayload.message.content })}`
        )
      }
      syntheticEvents.push('data: [DONE]')

      finalizeResponse = new Response(`${syntheticEvents.join('\n')}\n`, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    } else {
      finalizeResponse = await createStreamingRequest('/generate/ephemeral', accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalizeRequestBody),
        signal: subagentAbortController.signal,
      })
    }

    if (!finalizeResponse.ok) {
      const errorText = await finalizeResponse.text()
      throw new Error(`Subagent finalization failed: HTTP ${finalizeResponse.status}: ${errorText}`)
    }

    const finalizeReader = finalizeResponse.body?.getReader()
    if (!finalizeReader) {
      throw new Error('No response body from subagent finalization')
    }

    const finalizeDecoder = new TextDecoder()
    let finalizeText = ''
    let finalizeReasoning = ''
    let finalizeBuffer = ''

    while (true) {
      if (!isStreamActive()) {
        subagentAbortController.abort()
        throw new Error('Subagent aborted')
      }

      const { done, value } = await finalizeReader.read()
      if (done) break

      const chunk = finalizeDecoder.decode(value, { stream: true })
      finalizeBuffer += chunk

      const lines = finalizeBuffer.split('\n')
      finalizeBuffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          if (parsed?.type === 'chunk' && parsed?.part) {
            if (parsed.part === 'text') {
              const delta = parsed.delta ?? parsed.content ?? parsed.text
              if (typeof delta === 'string') finalizeText += delta
            } else if (parsed.part === 'reasoning') {
              const delta = parsed.delta ?? parsed.reasoning
              if (typeof delta === 'string') finalizeReasoning += delta
            }
          } else if (parsed?.text) {
            if (typeof parsed.text === 'string') finalizeText += parsed.text
          } else if (parsed?.reasoning) {
            if (typeof parsed.reasoning === 'string') finalizeReasoning += parsed.reasoning
          } else if (parsed?.delta) {
            if (typeof parsed.delta === 'string') finalizeText += parsed.delta
          } else if (parsed?.content) {
            if (typeof parsed.content === 'string') finalizeText += parsed.content
          }
        } catch {
          if (data.trim()) {
            finalizeText += data
          }
        }
      }
    }

    const finalizeMessageId = uuidv4()
    const finalizeMessage: any = {
      id: finalizeMessageId,
      role: 'assistant',
      content: finalizeText,
      thinking_block: finalizeReasoning || null,
    }
    turnsUsed += 1

    const finalizeBlocks: any[] = []
    if (finalizeReasoning) finalizeBlocks.push({ type: 'thinking', content: finalizeReasoning })
    if (finalizeText) finalizeBlocks.push({ type: 'text', content: finalizeText })
    finalizeMessage.content_blocks = finalizeBlocks

    await appendSubagentMessage(subagentSessionId, {
      id: finalizeMessageId,
      role: 'assistant',
      content: finalizeText,
      thinking_block: finalizeReasoning || null,
      content_blocks: finalizeBlocks,
    })

    finalResponse = finalizeReasoning
      ? `<thinking>\n${finalizeReasoning}\n</thinking>\n\n${finalizeText}`
      : finalizeText
  }

  await updateSubagentRun(subagentSessionId, {
    status: 'completed',
    final_response: finalResponse || 'No response generated',
    turns_used: turnsUsed,
    tool_calls_used: toolCallsUsed,
  })

  return finalResponse || 'No response generated'
  // legacy summary removed\n\n${finalResponse || 'No response generated'}\n\n---\nTurns: ${turnsUsed}/${maxTurns} | Tool calls: ${totalToolCallsUsed}/${maxToolCalls} | Tools: ${toolSummary}`
}

