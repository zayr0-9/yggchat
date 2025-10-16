import fs from 'fs'
import OpenAI from 'openai'
import path from 'path'
import { MessageId } from '../../../shared/types'
import { ProviderCostService } from '../database/models'
import { getApiKey } from './apiKeyManager'
import tools from './tools'

// Helper function to convert Zod schema to JSON schema
function zodToJsonSchema(zodSchema: any): any {
  // Basic Zod to JSON schema conversion
  const def = zodSchema._def

  // Check multiple possible indicators that this is a Zod object
  if (def.typeName === 'ZodObject' || (def.shape && typeof def.shape === 'object')) {
    const properties: any = {}
    const required: string[] = []

    // Get the shape - handle both function and direct object
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape

    for (const [key, value] of Object.entries(shape || {})) {
      const fieldDef = (value as any)._def
      properties[key] = convertZodField(value as any)

      // Check if field is required (not optional and not default)
      if (fieldDef.typeName !== 'ZodOptional' && fieldDef.typeName !== 'ZodDefault') {
        required.push(key)
      }
    }

    const jsonSchema: any = {
      type: 'object',
      properties,
    }

    // Only add required if there are required fields
    if (required.length > 0) {
      jsonSchema.required = required
    }

    return jsonSchema
  }

  return { type: 'object', properties: {} }
}

function convertZodField(field: any): any {
  const def = field._def

  // Get description from the field (Zod v4 stores it in _def.description)
  const getDescription = (field: any): string | undefined => {
    // In Zod v4, description is stored in _def.description after calling .describe()
    if (def.description) return def.description
    if (field.description) return field.description
    if (field._def?.description) return field._def.description

    // Handle wrapped types (optional, default, etc.)
    if (def.innerType?._def?.description) return def.innerType._def.description

    return undefined
  }

  switch (def.typeName) {
    case 'ZodString':
      const stringSchema: any = { type: 'string' }
      const stringDesc = getDescription(field)
      if (stringDesc) stringSchema.description = stringDesc
      // Handle string constraints
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') stringSchema.minLength = check.value
          if (check.kind === 'max') stringSchema.maxLength = check.value
          if (check.kind === 'url') stringSchema.format = 'uri'
        }
      }
      return stringSchema

    case 'ZodNumber':
      const numberSchema: any = { type: 'number' }
      const numberDesc = getDescription(field)
      if (numberDesc) numberSchema.description = numberDesc
      // Handle number constraints
      if (def.checks) {
        for (const check of def.checks) {
          if (check.kind === 'min') numberSchema.minimum = check.value
          if (check.kind === 'max') numberSchema.maximum = check.value
          if (check.kind === 'int') numberSchema.type = 'integer'
        }
      }
      return numberSchema

    case 'ZodBoolean':
      const boolSchema: any = { type: 'boolean' }
      const boolDesc = getDescription(field)
      if (boolDesc) boolSchema.description = boolDesc
      return boolSchema

    case 'ZodArray':
      const arraySchema: any = {
        type: 'array',
        items: convertZodField(def.type),
      }
      const arrayDesc = getDescription(field)
      if (arrayDesc) arraySchema.description = arrayDesc
      // Handle array constraints
      if (def.minLength !== null) arraySchema.minItems = def.minLength?.value || def.minLength
      if (def.maxLength !== null) arraySchema.maxItems = def.maxLength?.value || def.maxLength
      return arraySchema

    case 'ZodEnum':
      const enumSchema: any = {
        type: 'string',
        enum: def.values,
      }
      const enumDesc = getDescription(field)
      if (enumDesc) enumSchema.description = enumDesc
      return enumSchema

    case 'ZodOptional':
      return convertZodField(def.innerType)

    case 'ZodDefault':
      const defaultSchema = convertZodField(def.innerType)
      defaultSchema.default = def.defaultValue()
      return defaultSchema

    default:
      // console.warn(`Unknown Zod type: ${def.typeName}`)
      return { type: 'string', description: getDescription(field) || 'Unknown field type' }
  }
}

// OpenRouter client will be created dynamically with encrypted API key
let openrouterInstance: OpenAI | null = null

// Model pricing cache
interface ModelPricing {
  prompt: number // Cost per 1K prompt tokens
  completion: number // Cost per 1K completion tokens
  cached_at: number // Timestamp when cached
}

let allModelsPricingCache: Map<string, ModelPricing> = new Map()
let lastFetchTime = 0
const PRICING_CACHE_DURATION = 60 * 60 * 1000 // 1 hour in milliseconds

async function getOpenRouterClient() {
  if (!openrouterInstance) {
    const apiKey = await getApiKey('OPENROUTER_API_KEY')
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not found or failed to decrypt')
    }

    const headers: Record<string, string> = {}
    const referer = process.env.OPENROUTER_REFERER || process.env.SITE_URL
    if (referer) headers['HTTP-Referer'] = referer
    const title = process.env.OPENROUTER_TITLE || 'Yggdrasil Chat'
    headers['X-Title'] = title

    openrouterInstance = new OpenAI({
      apiKey,
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      defaultHeaders: headers,
    })
  }
  return openrouterInstance
}

// Fetch all models pricing from OpenRouter and cache them
async function fetchAllModelsPricing(): Promise<void> {
  try {
    const client = await getOpenRouterClient()

    // Fetch all models from OpenRouter
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${client.apiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_REFERER || process.env.SITE_URL || '',
        'X-Title': process.env.OPENROUTER_TITLE || 'Yggdrasil Chat',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Failed to fetch models: ${response.status} ${response.statusText}`, errorText)
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`)
    }

    const data: any = await response.json()
    const models = data.data || []
    console.log(`Found ${models.length} models from OpenRouter`)

    // Clear existing cache and rebuild
    allModelsPricingCache.clear()
    let cachedCount = 0

    // Cache all models with pricing
    models.forEach((modelInfo: any) => {
      if (modelInfo.pricing && (modelInfo.id || modelInfo.name)) {
        const modelId = modelInfo.id || modelInfo.name
        const pricing: ModelPricing = {
          prompt: parseFloat(modelInfo.pricing.prompt || 0),
          completion: parseFloat(modelInfo.pricing.completion || 0),
          cached_at: Date.now(),
        }

        allModelsPricingCache.set(modelId, pricing)
        cachedCount++

        // Debug log for first few models
        if (cachedCount <= 5) {
          // console.log(`Cached ${modelId}:`, {
          //   prompt: `$${pricing.prompt}/1K tokens`,
          //   completion: `$${pricing.completion}/1K tokens`,
          // })
        }
      }
    })

    lastFetchTime = Date.now()
  } catch (error) {
    console.error('Error fetching all models pricing:', error)
  }
}

// Get pricing for a specific model (uses the all-models cache)
async function getModelPricing(model: string): Promise<ModelPricing | null> {
  try {
    // Check if we need to fetch all models (first time or cache expired)
    if (Date.now() - lastFetchTime > PRICING_CACHE_DURATION || allModelsPricingCache.size === 0) {
      await fetchAllModelsPricing()
    }

    // Look up the specific model in our comprehensive cache
    const pricing = allModelsPricingCache.get(model)

    if (pricing) {
      // console.log(`Found cached pricing for ${model}:`, {
      //   prompt: `$${pricing.prompt}/1K tokens`,
      //   completion: `$${pricing.completion}/1K tokens`,
      // })
      return pricing
    } else {
      // console.log(`No pricing found for model: ${model}`)
      // console.log(
      //   `Available models in cache:`,
      //   Array.from(allModelsPricingCache.keys())
      //     .filter(k => k.includes('grok') || k.includes('claude') || k.includes('gpt'))
      //     .slice(0, 10)
      // )
      return null
    }
  } catch (error) {
    console.error('Error getting model pricing:', error)
    return null
  }
}

// Calculate token costs
function calculateTokenCosts(
  usage: any,
  pricing: ModelPricing | null
): { promptCost: number; completionCost: number; reasoningCost: number; totalCost: number } {
  if (!pricing || !usage) {
    return { promptCost: 0, completionCost: 0, reasoningCost: 0, totalCost: 0 }
  }

  const promptTokens = usage.prompt_tokens || 0
  const completionTokens = usage.completion_tokens || 0
  const reasoningTokens = usage.reasoning_tokens || 0

  const promptCost = (promptTokens / 1000) * pricing.prompt
  const completionCost = (completionTokens / 1000) * pricing.completion

  // Use pricing.reasoning if available, otherwise treat reasoning as completion tokens
  // (ModelPricing interface can be extended to add reasoning later)
  const reasoningRate = (pricing as any).reasoning ?? pricing.completion
  const reasoningCost = (reasoningTokens / 1000) * reasoningRate

  const totalCost = promptCost + completionCost + reasoningCost

  return { promptCost, completionCost, reasoningCost, totalCost }
}

// Preload pricing for all available models
export async function preloadModelPricing() {
  await fetchAllModelsPricing()
}

// Helper function to format tool calls into user-friendly messages
function formatToolCallForUser(toolName: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson)

    switch (toolName) {
      case 'brave_search':
        return `🔍 Searching the web for: ${args.query || 'unknown'}`

      case 'browse_web':
        return `🌐 Surfing the web to: ${args.url || 'unknown URL'}`

      case 'read_file':
        return `📄 Reading file: ${args.path || 'unknown file'}`

      case 'read_files':
        const fileCount = args.paths?.length || 0
        return `📚 Reading ${fileCount} file${fileCount !== 1 ? 's' : ''}`

      case 'directory':
        return `📁 Exploring directory: ${args.path || 'unknown path'}`

      case 'create_file':
        return `✏️ Creating file: ${args.path || 'unknown file'}`

      case 'edit_file':
        return `✏️ Editing file: ${args.path || 'unknown file'}`

      case 'delete_file':
        return `🗑️ Deleting file: ${args.path || 'unknown file'}`

      case 'search_history':
        return `🔎 Searching chat history for: ${args.query || 'unknown'}`

      default:
        return `🔧 Using tool: ${toolName}`
    }
  } catch (error) {
    // If parsing fails, return a generic message
    return `🔧 Using tool: ${toolName}`
  }
}

export async function generateResponse(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onChunk: (chunk: string) => void,
  model: string = 'openrouter/auto',
  attachments?: Array<{ mimeType?: string; filePath?: string }>,
  abortSignal?: AbortSignal,
  think: boolean = false,
  messageId?: MessageId,
  userId?: string,
  tool_detail: boolean = false
): Promise<void> {
  const MAX_STEPS = 400 // Reduced to prevent infinite loops with problematic models
  let stepCount = 0
  let conversationMessages = [...messages]

  // Track total costs across all steps
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalReasoningTokens = 0
  let totalCostUSD = 0
  let totalOpenRouterCredits = 0

  // Move these outside the loop to persist across iterations and during abort
  let finalUsage: any = null
  let openrouterCreditsUsed = 0
  let assistantContent = ''
  let costAlreadyLogged = false // Prevent double-logging when aborted

  // Convert tools to OpenAI format
  const openaiTools = tools
    .filter(tool => tool.enabled)
    .map(tool => {
      // Convert Zod schema to JSON schema
      let parameters: any
      try {
        // If inputSchema has a _def property, it's a Zod schema
        if (tool.tool.inputSchema && typeof tool.tool.inputSchema._def === 'object') {
          // Convert Zod schema to JSON schema format
          parameters = zodToJsonSchema(tool.tool.inputSchema)
        } else {
          // Already in JSON schema format
          parameters = tool.tool.inputSchema.schema || tool.tool.inputSchema
        }
      } catch (error) {
        console.error(`Failed to convert schema for tool ${tool.name}:`, error)
        parameters = { type: 'object', properties: {} }
      }

      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.tool.description,
          parameters,
        },
      }
    })

  // Main conversation loop - allows multiple tool calls and responses
  while (stepCount < MAX_STEPS) {
    stepCount++

    // Reset assistant content for this step (but keep finalUsage to track across steps)
    assistantContent = ''

    if (abortSignal?.aborted) {
      // Log partial usage if available before returning (only if not already logged)
      if (finalUsage && !costAlreadyLogged) {
        try {
          const totals = {
            totalPromptTokens,
            totalCompletionTokens,
            totalReasoningTokens,
            totalCostUSD,
            totalOpenRouterCredits,
          }
          await logGenerationCost(model, stepCount, finalUsage, totals)
          totalPromptTokens = totals.totalPromptTokens
          totalCompletionTokens = totals.totalCompletionTokens
          totalReasoningTokens = totals.totalReasoningTokens
          totalCostUSD = totals.totalCostUSD
          totalOpenRouterCredits = totals.totalOpenRouterCredits
          console.log(`📊 Logged partial cost on abort: $${totals.totalCostUSD.toFixed(6)}`)
        } catch (logError) {
          console.error('Error logging partial usage on abort:', logError)
        }
      }
      return
    }

    // Prepare messages for this step
    let formattedMessages: any[] = conversationMessages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }))

    // Handle image attachments (only for the first step)
    if (stepCount === 1) {
      formattedMessages = await handleImageAttachments(formattedMessages, attachments)
    }

    // Create synchronous abort flag that will be set via event listener (outside try block for catch access)
    let abortRequested = false

    // Listen for abort event to set flag synchronously
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        abortRequested = true
      })
    }

    try {
      const openrouterClient = await getOpenRouterClient()

      const stream: any = await openrouterClient.chat.completions.create(
        {
          model,
          messages: formattedMessages,
          stream: true,
          max_tokens: 100000,
          tools: openaiTools.length > 0 ? openaiTools : undefined,
          usage: { include: true },
          ...(think && { reasoning: { max_tokens: 30000 } }),
        } as any,
        {
          signal: abortSignal,
        }
      )

      let toolCalls: Array<{ id: string; name: string; arguments: string }> = []
      let currentToolCall: any = null
      let toolCallBuffer = ''

      // Process the stream
      for await (const chunk of stream) {
        // Check for abort FIRST - throw immediately to force exit the for-await loop
        if (abortRequested) {
          const error: any = new Error('Generation aborted by user')
          error.name = 'AbortError'
          throw error
        }

        // Handle usage information - this contains the cost according to OpenRouter docs
        if (chunk.usage) {
          finalUsage = chunk.usage // Store/update usage incrementally
          // OpenRouter provides cost in credits via chunk.usage.cost
          if (chunk.usage.cost !== undefined) {
            openrouterCreditsUsed = parseFloat(chunk.usage.cost) || 0
            console.log(`💰 OpenRouter cost found in chunk: ${chunk.usage.cost} credits`)
          }
        }

        // console.log('chunk id #######', chunk.id)

        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta
        if (!delta) continue

        // Handle reasoning content (thinking mode)
        if ((delta as any).reasoning && think) {
          const reasoningContent = (delta as any).reasoning
          onChunk(JSON.stringify({ part: 'reasoning', delta: reasoningContent }))
          continue
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            if (toolCall.id && toolCall.function?.name) {
              // New tool call
              currentToolCall = {
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments || '',
              }
              toolCallBuffer = toolCall.function.arguments || ''
            } else if (currentToolCall && toolCall.function?.arguments) {
              // Continue existing tool call
              toolCallBuffer += toolCall.function.arguments
              currentToolCall.arguments = toolCallBuffer
            }

            // Try to send complete tool calls
            if (currentToolCall && toolCallBuffer) {
              try {
                // Try to parse as JSON first
                JSON.parse(toolCallBuffer)
                const toolCallData = {
                  id: currentToolCall.id,
                  name: currentToolCall.name,
                  arguments: toolCallBuffer,
                }

                // Format the tool call message based on tool_detail flag
                const toolMessage = tool_detail
                  ? JSON.stringify(toolCallData) + '\n'
                  : formatToolCallForUser(currentToolCall.name, toolCallBuffer) + '\n'

                onChunk(JSON.stringify({ part: 'tool_call', delta: toolMessage }))

                // Add to our tool calls list for execution
                const existingIndex = toolCalls.findIndex(tc => tc.id === currentToolCall.id)
                if (existingIndex >= 0) {
                  toolCalls[existingIndex] = toolCallData
                } else {
                  toolCalls.push(toolCallData)
                }
              } catch {
                // If JSON parsing fails, check if we have empty object - this might be Grok's issue
                if (toolCallBuffer === '{}' || !toolCallBuffer.trim()) {
                  console.log(
                    `Warning: Tool call ${currentToolCall.name} has empty arguments, will try to extract from content`
                  )
                  // Store the tool call anyway, we'll try to parse from content later
                  const toolCallData = {
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    arguments: toolCallBuffer || '{}',
                  }

                  const existingIndex = toolCalls.findIndex(tc => tc.id === currentToolCall.id)
                  if (existingIndex >= 0) {
                    toolCalls[existingIndex] = toolCallData
                  } else {
                    toolCalls.push(toolCallData)
                  }
                }
                // Otherwise JSON not complete yet, continue accumulating
              }
            }
          }
          continue
        }

        // Handle regular content
        if (delta.content) {
          assistantContent += delta.content
          onChunk(JSON.stringify({ part: 'text', delta: delta.content, chunkId: chunk.id }))
        }

        // Check if conversation is finished (no more deltas)
        if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
          // If no usage data was provided, create estimated usage
          if (!finalUsage) {
            finalUsage = createEstimatedUsage(formattedMessages, assistantContent)
          }

          // Add OpenRouter credits to the final usage object
          if (openrouterCreditsUsed > 0) {
            finalUsage.cost = openrouterCreditsUsed // Ensure cost is in the final usage object
            console.log(`🔹 OpenRouter credits captured from stream: ${openrouterCreditsUsed}`)
          } else if (finalUsage.cost) {
            openrouterCreditsUsed = parseFloat(finalUsage.cost) || 0
            console.log(`🔹 OpenRouter credits found in final usage: ${finalUsage.cost}`)
          }

          break
        }
      }

      // If we have tool calls, execute them and continue the conversation
      if (toolCalls.length > 0) {
        // Remove duplicate tool calls to prevent infinite loops
        const uniqueToolCalls = toolCalls.filter(
          (tc, index, arr) => arr.findIndex(t => t.name === tc.name && t.arguments === tc.arguments) === index
        )

        console.log(
          `Executing ${uniqueToolCalls.length} unique tool calls:`,
          uniqueToolCalls.map(tc => tc.name)
        )

        // Add assistant message with tool calls to conversation
        conversationMessages.push({
          role: 'assistant',
          content: assistantContent || 'I need to use some tools to help you.',
        })

        // Execute tools and add their results
        for (const toolCall of uniqueToolCalls) {
          // Try to extract parameters from content if arguments are empty
          let finalArguments = toolCall.arguments
          if (!finalArguments || finalArguments === '{}') {
            finalArguments = extractParametersFromContent(assistantContent, toolCall.name)
            console.log(`Extracted parameters for ${toolCall.name}:`, finalArguments)
          }

          const result = await executeToolCall(toolCall.name, finalArguments)
          console.log(`Tool ${toolCall.name} result:`, result.substring(0, 200) + (result.length > 200 ? '...' : ''))

          conversationMessages.push({
            role: 'user', // Tool results are treated as user messages in simple format
            content: `Tool ${toolCall.name} result: ${result}`,
          })
        }

        // Continue to next step to process tool results
        continue
      } else {
        // No tool calls, conversation is complete
        if (assistantContent) {
          conversationMessages.push({
            role: 'assistant',
            content: assistantContent,
          })
        }
        break
      }
    } catch (error: any) {
      const isAbort =
        abortRequested ||
        abortSignal?.aborted ||
        error?.name === 'AbortError' ||
        error?.name === 'APIUserAbortError' ||
        String(error || '')
          .toLowerCase()
          .includes('abort')

      if (isAbort) {
        // Log partial usage or estimate before returning on abort
        if (!finalUsage) {
          finalUsage = createEstimatedUsage(formattedMessages, assistantContent)
          console.log('⚠️ Generation aborted - using estimated usage for cost calculation')
        }
        if (finalUsage && !costAlreadyLogged) {
          try {
            const totals = {
              totalPromptTokens,
              totalCompletionTokens,
              totalReasoningTokens,
              totalCostUSD,
              totalOpenRouterCredits,
            }
            await logGenerationCost(model, stepCount, finalUsage, totals)
            totalPromptTokens = totals.totalPromptTokens
            totalCompletionTokens = totals.totalCompletionTokens
            totalReasoningTokens = totals.totalReasoningTokens
            totalCostUSD = totals.totalCostUSD
            totalOpenRouterCredits = totals.totalOpenRouterCredits
            costAlreadyLogged = true
            console.log(`📊 Logged partial cost on abort (error): $${totals.totalCostUSD.toFixed(6)}`)
          } catch (logError) {
            console.error('Error logging usage on abort error:', logError)
          }
        }
        return
      }

      // Check if error is related to tool support and retry without tools
      const errorMsg = error?.message || String(error)
      const isToolError =
        (error?.status === 404 && errorMsg.includes('tool use')) ||
        (error?.status === 400 && errorMsg.includes('Provider returned error')) ||
        errorMsg.includes('No endpoints found that support tool use')

      if (isToolError && openaiTools.length > 0) {
        try {
          const retryClient = await getOpenRouterClient()
          const stream: any = await retryClient.chat.completions.create(
            {
              model,
              messages: formattedMessages,
              stream: true,
              max_tokens: 4000,
              usage: { include: true },
              ...(think && { reasoning: { max_tokens: 10000 } }),
            } as any,
            {
              signal: abortSignal,
            }
          )

          // Process the stream without tools (simplified version)
          assistantContent = '' // Reset for retry
          let chunkCount = 0

          for await (const chunk of stream) {
            chunkCount++

            if (chunk.usage) {
              finalUsage = chunk.usage // Store/update usage incrementally

              // Capture cost from retry attempt as well
              if (chunk.usage.cost !== undefined) {
                openrouterCreditsUsed = parseFloat(chunk.usage.cost) || 0
                console.log(`💰 OpenRouter cost found in retry chunk: ${chunk.usage.cost} credits`)
              }
            }

            // Check for abort after capturing usage
            if (abortSignal?.aborted) {
              // Log partial usage before breaking, or estimate if no usage received
              if (!finalUsage) {
                finalUsage = createEstimatedUsage(formattedMessages, assistantContent)
              } else {
              }
              try {
                const totals = {
                  totalPromptTokens,
                  totalCompletionTokens,
                  totalReasoningTokens,
                  totalCostUSD,
                  totalOpenRouterCredits,
                }
                await logGenerationCost(model, stepCount, finalUsage, totals)
                totalPromptTokens = totals.totalPromptTokens
                totalCompletionTokens = totals.totalCompletionTokens
                totalReasoningTokens = totals.totalReasoningTokens
                totalCostUSD = totals.totalCostUSD
                totalOpenRouterCredits = totals.totalOpenRouterCredits
                costAlreadyLogged = true // Mark as logged to prevent double-logging in finally
              } catch (logError) {
                console.error('Error logging partial usage on abort in retry stream:', logError)
              }
              break
            }

            const choice = chunk.choices?.[0]
            if (!choice) continue

            const delta = choice.delta
            if (!delta) continue

            if (delta.content) {
              assistantContent += delta.content
              onChunk(JSON.stringify({ part: 'text', delta: delta.content }))
            }

            if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
              if (!finalUsage) {
                finalUsage = createEstimatedUsage(formattedMessages, assistantContent)
              }
              // Ensure cost is in final usage for retry case
              if (openrouterCreditsUsed > 0) {
                finalUsage.cost = openrouterCreditsUsed
              }
              break
            }
          }

          if (assistantContent) {
            conversationMessages.push({
              role: 'assistant',
              content: assistantContent,
            })
          }
          break // Exit the step loop since we completed successfully
        } catch (retryError: any) {
          console.error('DEBUG: Retry without tools also failed:', retryError?.message || String(retryError))
          const retryErrorMessage = retryError?.error?.message || retryError?.message || String(retryError)
          onChunk(JSON.stringify({ part: 'error', delta: retryErrorMessage }))
          throw retryError
        }
      } else {
        const errorMessage = error?.error?.message || error?.message || String(error)
        onChunk(JSON.stringify({ part: 'error', delta: errorMessage }))
        throw error
      }
    } finally {
      // Log final generation cost summary for this step (runs regardless of success/error)
      // Skip if already logged during abort handling
      if (!costAlreadyLogged) {
        // If no usage data received but we have content, create estimate
        if (!finalUsage && assistantContent) {
          finalUsage = createEstimatedUsage(formattedMessages, assistantContent)
          console.log('⚠️ No usage data received - using estimated usage for cost calculation')
        }

        if (finalUsage) {
          try {
            const totals = {
              totalPromptTokens,
              totalCompletionTokens,
              totalReasoningTokens,
              totalCostUSD,
              totalOpenRouterCredits,
            }
            await logGenerationCost(model, stepCount, finalUsage, totals)

            // Update the totals back to the outer scope
            totalPromptTokens = totals.totalPromptTokens
            totalCompletionTokens = totals.totalCompletionTokens
            totalReasoningTokens = totals.totalReasoningTokens
            totalCostUSD = totals.totalCostUSD
            totalOpenRouterCredits = totals.totalOpenRouterCredits
          } catch (logError) {
            console.error('Error logging generation cost:', logError)
          }
        }
      }
      // Reset the flag for next iteration
      costAlreadyLogged = false
    }
  }

  if (stepCount >= MAX_STEPS) {
    onChunk(JSON.stringify({ part: 'error', delta: 'Maximum steps reached' }))
  }

  // Log final total cost summary
  // console.log('\n' + '='.repeat(50))
  // console.log('🎯 TOTAL GENERATION SUMMARY')
  // console.log('='.repeat(50))
  // console.log(`Model: ${model}`)
  // console.log(`Total Steps: ${stepCount}`)
  // console.log(`Total Tokens: ${totalPromptTokens + totalCompletionTokens + totalReasoningTokens}`)
  // console.log(`  • Prompt Tokens: ${totalPromptTokens}`)
  // console.log(`  • Completion Tokens: ${totalCompletionTokens}`)
  // if (totalReasoningTokens > 0) {
  //   console.log(`  • Reasoning Tokens: ${totalReasoningTokens}`)
  // }
  // console.log(`Total Cost: $${totalCostUSD.toFixed(6)} USD`)
  // if (totalOpenRouterCredits > 0) {
  //   console.log(`Total OpenRouter Credits: ${totalOpenRouterCredits.toFixed(6)}`)
  // }
  // console.log('='.repeat(50))

  // Save final aggregated cost data to database if messageId and userId are provided
  if (messageId && userId && (totalPromptTokens > 0 || totalCompletionTokens > 0 || totalReasoningTokens > 0)) {
    try {
      ProviderCostService.create({
        userId,
        messageId,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        reasoningTokens: totalReasoningTokens,
        approxCost: totalCostUSD,
        apiCreditCost: totalOpenRouterCredits,
      })
      console.log(`💾 Saved final cost data for user ${userId}, message ${messageId}: $${totalCostUSD.toFixed(6)} USD`)
    } catch (error) {
      console.error('Error saving final cost data to database:', error)
    }
  }
}

// Log generation cost summary
async function logGenerationCost(
  model: string,
  stepCount: number,
  usage: any,
  totals: {
    totalPromptTokens: number
    totalCompletionTokens: number
    totalReasoningTokens: number
    totalCostUSD: number
    totalOpenRouterCredits: number
  }
): Promise<void> {
  try {
    // Update totals
    totals.totalPromptTokens += usage.prompt_tokens || 0
    totals.totalCompletionTokens += usage.completion_tokens || 0
    totals.totalReasoningTokens += usage.reasoning_tokens || 0
    // Debug: Log the entire usage object to see its structure
    console.log('📊 Usage object received:', JSON.stringify(usage, null, 2))

    // Try multiple fields for OpenRouter credits
    let creditsFromUsage = 0
    if (usage.cost) {
      creditsFromUsage = parseFloat(usage.cost) || 0
    } else if (usage.credits) {
      creditsFromUsage = parseFloat(usage.credits) || 0
    } else if (usage.openrouter_credits) {
      creditsFromUsage = parseFloat(usage.openrouter_credits) || 0
    } else if (usage.total_cost) {
      creditsFromUsage = parseFloat(usage.total_cost) || 0
    }

    if (creditsFromUsage > 0) {
      totals.totalOpenRouterCredits += creditsFromUsage
      console.log('💰 OpenRouter credits found:', creditsFromUsage, 'Total:', totals.totalOpenRouterCredits)
    } else {
      console.log('⚠️ No cost/credits found in usage object fields:', Object.keys(usage))
    }

    const pricing = await getModelPricing(model)
    if (pricing) {
      const costs = calculateTokenCosts(usage, pricing)
      totals.totalCostUSD += costs.totalCost
    }
  } catch (error) {
    console.log(`\n🔹 Step ${stepCount} Generation Summary:`)
    console.log(`Model: ${model}`)
    console.log(`Tokens: ${usage.total_tokens || 'unknown'}`)
    console.log('Cost: Error calculating -', error)
    console.log()
  }
}

// Create estimated usage when OpenRouter doesn't provide it
function createEstimatedUsage(messages: any[], assistantContent: string): any {
  // Simple token estimation: ~4 characters per token (rough approximation)
  const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

  // Calculate prompt tokens from all messages
  let promptTokens = 0
  messages.forEach(msg => {
    if (typeof msg.content === 'string') {
      promptTokens += estimateTokens(msg.content)
    } else if (Array.isArray(msg.content)) {
      msg.content.forEach((part: any) => {
        if (part.type === 'text' && part.text) {
          promptTokens += estimateTokens(part.text)
        }
      })
    }
  })

  // Calculate completion tokens from assistant response
  const completionTokens = estimateTokens(assistantContent)
  const totalTokens = promptTokens + completionTokens

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    estimated: true, // Flag to indicate this is estimated
  }
}

// Helper function to extract parameters from XML-like content (for Grok compatibility)
function extractParametersFromContent(content: string, toolName: string): string {
  try {
    const params: any = {}

    // Look for <parameter name="key">value</parameter> patterns
    const parameterRegex = /<parameter name="([^"]+)">([^<]*)<\/parameter>/g
    let match

    while ((match = parameterRegex.exec(content)) !== null) {
      const [, paramName, paramValue] = match
      params[paramName] = paramValue.trim()
    }

    // If we found parameters, return them as JSON
    if (Object.keys(params).length > 0) {
      console.log(`Extracted parameters for ${toolName}:`, params)
      return JSON.stringify(params)
    }

    // Fallback: try to extract query from content for search tools
    if (toolName === 'brave_search') {
      // Look for query-like content in the message
      const lines = content.split('\n').filter(line => line.trim())
      for (const line of lines) {
        if (line.includes('query') || line.length > 10) {
          // Extract meaningful text that could be a search query
          const cleanLine = line.replace(/<[^>]*>/g, '').trim()
          if (cleanLine && cleanLine.length > 3) {
            return JSON.stringify({ query: cleanLine, count: 10 })
          }
        }
      }
    }

    return '{}'
  } catch (error) {
    console.log('Error extracting parameters from content:', error)
    return '{}'
  }
}

// Helper function to execute tools
async function executeToolCall(toolName: string, args: string): Promise<string> {
  try {
    const tool = tools.find(t => t.name === toolName && t.enabled)
    if (!tool) {
      return `Error: Tool '${toolName}' not found or not enabled`
    }

    const parsedArgs = JSON.parse(args)
    const result = await tool.tool.execute(parsedArgs)
    return JSON.stringify(result)
  } catch (error) {
    return `Error executing tool: ${error instanceof Error ? error.message : String(error)}`
  }
}

// Helper function to handle image attachments
async function handleImageAttachments(
  formattedMessages: any[],
  attachments?: Array<{ mimeType?: string; filePath?: string }>
) {
  const imageAtts = (attachments || []).filter(a => a.filePath)
  if (imageAtts.length === 0) return formattedMessages

  // Convert user/assistant to structured parts; keep system as plain string
  formattedMessages = formattedMessages.map((m: any) =>
    m.role === 'system'
      ? { role: m.role, content: String(m.content || '') }
      : { role: m.role, content: [{ type: 'text', text: String(m.content || '') }] }
  )

  // Find last user message index
  let lastUserIdx = -1
  for (let i = formattedMessages.length - 1; i >= 0; i--) {
    if (formattedMessages[i].role === 'user') {
      lastUserIdx = i
      break
    }
  }

  // If none, append a new user message for attachments
  if (lastUserIdx === -1) {
    formattedMessages.push({ role: 'user', content: [{ type: 'text', text: '' }] })
    lastUserIdx = formattedMessages.length - 1
  }

  const parts: any[] = []
  for (const att of imageAtts) {
    try {
      const baseDir = path.resolve(__dirname, '..')
      let abs = path.isAbsolute(att.filePath!) ? att.filePath! : path.join(baseDir, att.filePath!)
      if (!fs.existsSync(abs)) {
        const tryRoutes = path.resolve(__dirname, '..', 'routes', att.filePath!)
        const tryHere = path.resolve(__dirname, att.filePath!)
        const tryCwd = path.resolve(process.cwd(), att.filePath!)
        const tryDist = path.resolve(process.cwd(), 'dist', att.filePath!)
        const trySrc = path.resolve(process.cwd(), 'src', att.filePath!)
        const candidates = [tryRoutes, tryHere, tryCwd, tryDist, trySrc]
        const found = candidates.find(p => fs.existsSync(p))
        if (found) {
          abs = found
          console.log(`Resolved attachment path: ${abs}`)
        }
      }
      const buf = fs.readFileSync(abs)
      const mediaType = att.mimeType || 'image/jpeg'
      const base64 = buf.toString('base64')
      // Add image in OpenAI format
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${mediaType};base64,${base64}`,
        },
      })
    } catch {
      // Ignore failed attachment read
    }
  }

  // Add images to the last user message
  const existing = Array.isArray(formattedMessages[lastUserIdx].content)
    ? formattedMessages[lastUserIdx].content
    : [{ type: 'text', text: String(formattedMessages[lastUserIdx].content || '') }]

  formattedMessages[lastUserIdx] = {
    role: 'user',
    content: [...existing, ...parts],
  }

  return formattedMessages
}
