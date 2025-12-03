import { randomUUID } from 'crypto'
import fs from 'fs'
import OpenAI from 'openai'
import path from 'path'
import { MessageId } from '../../../shared/types'
import { ProviderCostService } from '../database/models'
import { supabaseAdmin } from '../database/supamodels'
import { getApiKey } from './apiKeyManager'
import { getCachedAttachmentBase64 } from './attachmentCache'
import { canAccessPaidModels } from './freeTier'
import { moneyAdd, moneyFormat, moneyMax, moneyMultiply } from './money'
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

// Normalize Zod v4 type names to match the switch cases
function getZodTypeName(def: any): string {
  // Zod v4 uses lowercase type names, convert to PascalCase for consistency
  if (def.type) {
    const typeMap: Record<string, string> = {
      string: 'ZodString',
      number: 'ZodNumber',
      boolean: 'ZodBoolean',
      array: 'ZodArray',
      object: 'ZodObject',
      optional: 'ZodOptional',
      nullable: 'ZodNullable',
      enum: 'ZodEnum',
      union: 'ZodUnion',
      default: 'ZodDefault',
      effects: 'ZodEffects',
    }
    return typeMap[def.type] || def.type
  }
  return 'Unknown'
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

  switch (getZodTypeName(def)) {
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
        items: convertZodField(def.element),
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
    const title = process.env.OPENROUTER_TITLE || 'Yggdrasil'
    headers['X-Title'] = title
    headers['HTTP-Referer'] = 'https://yggchat.com'
    headers['X-Title'] = 'Yggdrasil'

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
        'X-Title': process.env.OPENROUTER_TITLE || 'Yggdrasil',
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

  // Use precise decimal arithmetic for financial calculations
  const promptCost = moneyMultiply(promptTokens / 1000, pricing.prompt)
  const completionCost = moneyMultiply(completionTokens / 1000, pricing.completion)

  // Use pricing.reasoning if available, otherwise treat reasoning as completion tokens
  // (ModelPricing interface can be extended to add reasoning later)
  const reasoningRate = (pricing as any).reasoning ?? pricing.completion
  const reasoningCost = moneyMultiply(reasoningTokens / 1000, reasoningRate)

  const totalCost = moneyAdd(moneyAdd(promptCost, completionCost), reasoningCost)

  return { promptCost, completionCost, reasoningCost, totalCost }
}

// Preload pricing for all available models
export async function preloadModelPricing() {
  await fetchAllModelsPricing()
}

// ===========================================================================
// TWO-PHASE CREDIT RESERVATION SYSTEM
// ===========================================================================

/**
 * Estimate credits needed for a generation request
 * Uses a conservative multiplier to ensure we don't run out mid-generation
 */
function estimateCreditsForGeneration(
  messages: Array<{ role: string; content: any }>,
  model: string,
  pricing: ModelPricing | null
): number {
  if (!pricing) {
    // If no pricing data, use a conservative estimate
    // Assume ~1000 tokens at $0.01/1K = 0.01 credits, with 3x safety margin
    return 0.03
  }

  // Estimate prompt tokens (rough: 4 chars per token)
  let promptChars = 0
  messages.forEach(msg => {
    if (typeof msg.content === 'string') {
      promptChars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      msg.content.forEach((part: any) => {
        if (part.type === 'text' && part.text) {
          promptChars += part.text.length
        }
      })
    }
  })

  const estimatedPromptTokens = Math.ceil(promptChars / 4)
  // Assume completion will be ~30% of prompt length (conservative)
  const estimatedCompletionTokens = Math.ceil(estimatedPromptTokens * 0.3)

  // Calculate cost in USD using precise decimal arithmetic
  const estimatedPromptCost = moneyMultiply(estimatedPromptTokens / 1000, pricing.prompt)
  const estimatedCompletionCost = moneyMultiply(estimatedCompletionTokens / 1000, pricing.completion)

  // Apply 2x safety multiplier (actual usage often less than estimate)
  // Convert USD to credits (assuming 1:1 mapping, adjust if needed)
  const estimatedCredits = moneyMultiply(moneyAdd(estimatedPromptCost, estimatedCompletionCost), 2)

  // Minimum reservation: 0.001 credits
  return moneyMax(0.001, estimatedCredits)
}

/**
 * Reserve credits atomically before starting a generation
 * Returns reservation info or throws if insufficient credits
 */
async function reserveCreditsForGeneration(
  userId: string,
  model: string,
  pricing: ModelPricing | null,
  messages: Array<{ role: string; content: any }>,
  stepIndex: number,
  messageId?: MessageId,
  conversationId?: string,
  storageMode: 'cloud' | 'local' = 'cloud'
): Promise<{ reservationRefId: string; reservedCredits: number; providerRunId: string }> {
  const reservedCredits = estimateCreditsForGeneration(messages, model, pricing)
  const reservationRefId = randomUUID()

  try {
    // Call the finance_reserve_credits function via Supabase RPC
    const { data, error } = await supabaseAdmin.rpc('finance_reserve_credits', {
      p_user_id: userId,
      p_ref_type: 'openrouter_gen_reserve',
      p_ref_id: reservationRefId,
      p_amount: reservedCredits,
      p_metadata: {
        model,
        message_id: messageId || null,
        conversation_id: conversationId || null,
        step_index: stepIndex,
        reserved_at: new Date().toISOString(),
      },
    })

    if (error) {
      // Check for specific error types
      if (error.message.includes('insufficient_credits')) {
        throw new Error(
          `Insufficient credits. You need ${moneyFormat(reservedCredits * 100)} credits, but your balance is lower. Please add more credits.`
        )
      }
      throw new Error(`Credit reservation failed: ${error.message}`)
    }

    const ledgerEntryId = data as string

    // Create provider_runs entry
    // For local mode, don't include conversation_id to avoid FK constraint errors
    // (local conversations don't exist in cloud Supabase)
    const { data: providerRun, error: providerRunError } = await supabaseAdmin
      .from('provider_runs')
      .insert({
        user_id: userId,
        conversation_id: storageMode === 'local' ? null : conversationId || null,
        message_id: messageId || null,
        model,
        reservation_ref_id: reservationRefId,
        step_index: stepIndex,
        status: 'running',
        reserved_credits: reservedCredits,
      })
      .select('id')
      .single()

    if (providerRunError) {
      console.error('Error creating provider_runs entry:', providerRunError)
      // Don't fail the request, just log the error
      // The reservation was successful, so we can proceed
    }

    console.log(
      `✅ Reserved ${moneyFormat(reservedCredits)} credits for user ${userId} (reservation: ${reservationRefId})`
    )

    return {
      reservationRefId,
      reservedCredits,
      providerRunId: providerRun?.id || '',
    }
  } catch (error: any) {
    console.error('Error reserving credits:', error)
    throw error
  }
}

/**
 * Update provider_runs with generation_id when we receive it from OpenRouter
 */
async function updateProviderRunWithGenerationId(
  providerRunId: string,
  generationId: string,
  reservationRefId: string
): Promise<void> {
  try {
    // Update provider_runs table
    const { error: runError } = await supabaseAdmin
      .from('provider_runs')
      .update({ generation_id: generationId })
      .eq('id', providerRunId)

    if (runError) {
      console.error('Error updating provider_runs with generation_id:', runError)
    }

    // Also update the reservation ledger entry metadata for easier debugging
    // Use raw SQL via rpc to merge JSONB in a single query
    const { error: ledgerError } = await supabaseAdmin.rpc('exec_sql', {
      sql: `
        UPDATE credits_ledger
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('generation_id', $1::text)
        WHERE external_ref_type = $2
        AND external_ref_id = $3
      `,
      params: [generationId, 'openrouter_gen_reserve', reservationRefId],
    })

    if (ledgerError) {
      console.error('Error updating ledger metadata with generation_id:', ledgerError)
    }

    console.log(`📝 Updated provider run ${providerRunId} with generation_id: ${generationId}`)
  } catch (error) {
    console.error('Error in updateProviderRunWithGenerationId:', error)
  }
}

/**
 * Mark provider_run as finished and set next reconciliation time
 * For aborted runs without generation_id, immediately refund reserved credits
 */
async function finishProviderRun(
  providerRunId: string,
  status: 'succeeded' | 'aborted' | 'failed',
  usage: any
): Promise<void> {
  try {
    // First, fetch the provider run to check if it has a generation_id
    const { data: providerRun, error: fetchError } = await supabaseAdmin
      .from('provider_runs')
      .select('generation_id, reserved_credits, user_id, reservation_ref_id, model')
      .eq('id', providerRunId)
      .single()

    if (fetchError) {
      console.error('Error fetching provider run:', fetchError)
      return
    }

    // Check if this is an aborted run without a generation_id
    // This means the stream never started, so no actual cost was incurred
    const needsImmediateRefund = status === 'aborted' && !providerRun?.generation_id

    if (needsImmediateRefund && providerRun) {
      console.log(
        `💸 Generation aborted before streaming - immediately refunding ${moneyFormat(providerRun.reserved_credits)} credits`
      )

      // Refund the full reserved amount since no generation occurred
      try {
        const { error: refundError } = await supabaseAdmin.rpc('finance_adjust_credits', {
          p_user_id: providerRun.user_id,
          p_ref_type: 'openrouter_gen_abort_refund',
          p_ref_id: providerRun.reservation_ref_id,
          p_delta: providerRun.reserved_credits, // Positive delta = refund
          p_kind: 'generation_refund',
          p_metadata: {
            model: providerRun.model,
            provider_run_id: providerRunId,
            reason: 'Generation aborted before streaming started - no cost incurred',
            refunded_at: new Date().toISOString(),
          },
          p_allow_negative: false,
        })

        if (refundError) {
          console.error('Error refunding credits for aborted generation:', refundError)
        } else {
          console.log(`✅ Refunded ${moneyFormat(providerRun.reserved_credits)} credits for aborted generation`)

          // Mark as reconciled immediately since we've handled the refund
          const { error: updateError } = await supabaseAdmin
            .from('provider_runs')
            .update({
              status: 'reconciled',
              actual_credits: 0, // No actual cost
              finished_at: new Date().toISOString(),
              reconciled_at: new Date().toISOString(),
              raw_usage: usage || null,
            })
            .eq('id', providerRunId)

          if (updateError) {
            console.error('Error updating provider run after refund:', updateError)
          } else {
            console.log(`🏁 Marked provider run ${providerRunId} as reconciled (immediate refund)`)
          }
          return
        }
      } catch (refundError) {
        console.error('Exception during credit refund:', refundError)
      }
    }

    // Normal case: mark as finished and let reconciliation worker handle it
    const { error } = await supabaseAdmin
      .from('provider_runs')
      .update({
        status,
        finished_at: new Date().toISOString(),
        next_reconcile_at: new Date().toISOString(), // Reconcile immediately
        raw_usage: usage || null,
      })
      .eq('id', providerRunId)

    if (error) {
      console.error('Error finishing provider run:', error)
    } else {
      console.log(`🏁 Marked provider run ${providerRunId} as ${status}, ready for reconciliation`)
    }
  } catch (error) {
    console.error('Error in finishProviderRun:', error)
  }
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
  tool_detail: boolean = true,
  conversationId?: string,
  executionMode: 'server' | 'client' = 'server',
  storageMode: 'cloud' | 'local' = 'cloud'
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

  // Track current provider run for credit management
  let currentProviderRunId: string | null = null
  let currentReservationRefId: string | null = null
  let generationIdCaptured = false

  // Server-only tools that are allowed in cloud mode (require API keys on server)
  const CLOUD_ALLOWED_TOOLS = ['brave_search', 'exa_search', 'exa_code_context']

  // Convert tools to OpenAI format
  // In cloud mode, only allow server-side search tools (no agentic/local tools)
  const openaiTools = tools
    .filter(tool => tool.enabled)
    .filter(tool => storageMode === 'local' || CLOUD_ALLOWED_TOOLS.includes(tool.name))
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
    generationIdCaptured = false // Reset for this step

    // ===================================================================
    // STEP 1: RESERVE CREDITS (Two-Phase Commit Pattern)
    // ===================================================================
    // Only reserve if userId is provided (meaning credits are enabled)
    if (userId) {
      // Check if user is on free tier
      const hasPaidAccess = await canAccessPaidModels(userId)

      if (hasPaidAccess) {
        // User has subscription or credits - proceed with normal credit reservation
        try {
          const pricing = await getModelPricing(model)
          const reservation = await reserveCreditsForGeneration(
            userId,
            model,
            pricing,
            conversationMessages,
            stepCount,
            messageId,
            conversationId,
            storageMode
          )
          currentProviderRunId = reservation.providerRunId
          currentReservationRefId = reservation.reservationRefId
          console.log(`💳 Step ${stepCount}: Reserved ${moneyFormat(reservation.reservedCredits)} credits`)
        } catch (error: any) {
          // If reservation fails (e.g., insufficient credits), stop the generation
          const errorMsg = error.message || 'Failed to reserve credits'
          onChunk(JSON.stringify({ part: 'error', delta: errorMsg }))
          throw error
        }
      } else {
        // Free tier user - skip credit reservation
        // Free generation eligibility already checked in supaChat.ts before calling generateResponse()
        console.log(`🆓 Step ${stepCount}: Free tier user - skipping credit reservation`)
      }
    }

    if (abortSignal?.aborted) {
      // Mark provider run as aborted
      if (currentProviderRunId) {
        await finishProviderRun(currentProviderRunId, 'aborted', finalUsage)
      }

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
          console.log(`📊 Logged partial cost on abort: $${moneyFormat(totals.totalCostUSD)}`)
        } catch (logError) {
          console.error('Error logging partial usage on abort:', logError)
        }
      }
      return
    }

    // Prepare messages for this step
    let formattedMessages: any[] = conversationMessages.map(msg => {
      const m = msg as any
      return {
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      }
    })

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

      // // Log messages being sent to API
      // console.log('📤 [openrouter] Messages sent to API:')
      // console.log('📤 [openrouter] Total messages:', formattedMessages.length)
      // for (let i = 0; i < formattedMessages.length; i++) {
      //   const msg = formattedMessages[i]
      //   if (msg.role === 'tool') {
      //     // console.log(
      //     //   `  [${i}] role=tool, tool_call_id=${msg.tool_call_id}, content_length=${msg.content?.length || 0}`
      //     // )
      //   } else if (msg.tool_calls) {
      //     console.log(
      //       `  [${i}] role=${msg.role}, has_tool_calls=true, tool_count=${msg.tool_calls.length}, content=${msg.content ? 'present' : 'null'}`
      //     )
      //     for (const tc of msg.tool_calls) {
      //       console.log(`    tool_call: id=${tc.id}, type=${tc.type}, function.name=${tc.function?.name}`)
      //     }
      //   } else if (typeof msg.content === 'string') {
      //     console.log(`  [${i}] role=${msg.role}, content_type=string, length=${msg.content.length}`)
      //   } else if (Array.isArray(msg.content)) {
      //     console.log(`  [${i}] role=${msg.role}, content_type=array, blocks=${msg.content.length}`)
      //     for (let j = 0; j < msg.content.length; j++) {
      //       const block = msg.content[j]
      //       if (block.type === 'text') {
      //         console.log(`    [${j}] type=text, length=${block.text?.length || 0}`)
      //       } else if (block.type === 'thinking') {
      //         console.log(`    [${j}] type=thinking, length=${block.thinking?.length || 0}`)
      //       } else if (block.type === 'tool_use') {
      //         console.log(`    [${j}] type=tool_use, id=${block.id}, name=${block.name}`)
      //       } else if (block.type === 'tool_result') {
      //         console.log(`    [${j}] type=tool_result, tool_use_id=${block.tool_use_id}, is_error=${block.is_error}`)
      //       }
      //     }
      //   } else {
      //     console.log(`  [${i}] role=${msg.role}, content_type=${typeof msg.content}`)
      //   }
      // }
      // console.log(
      //   '📤 [openrouter] Full message payload:',
      //   JSON.stringify(formattedMessages, null, 2).substring(0, 5000)
      // )

      const stream: any = await openrouterClient.chat.completions.create(
        {
          model, // e.g. "openrouter/auto" or a specific openrouter/<provider>/<model> id
          provider: {
            // Ask OpenRouter to route to the lowest-latency provider for this model
            sort: 'latency',

            // Optional: only use some providers (or remove this if you want all)
            // allow: ['openai', 'anthropic', 'deepinfra'],
            // Or explicitly avoid known slow ones:
            // deny: ['some-slow-provider'],
          },
          messages: formattedMessages,
          stream: true,
          max_tokens: 50000,
          tools: openaiTools.length > 0 ? openaiTools : undefined,
          usage: { include: true },
          ...(think && { reasoning: { max_tokens: 30000 } }),
        } as any,
        { signal: abortSignal }
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

        // ===================================================================
        // CAPTURE GENERATION ID (for reconciliation)
        // ===================================================================
        // OpenRouter returns generation ID in chunk.id (first chunk usually)
        if (chunk.id && !generationIdCaptured && currentProviderRunId && currentReservationRefId) {
          generationIdCaptured = true
          await updateProviderRunWithGenerationId(currentProviderRunId, chunk.id, currentReservationRefId)
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
          // console.log('🔧 [openrouter] Tool call delta received:', JSON.stringify(delta.tool_calls))
          for (const toolCall of delta.tool_calls) {
            if (toolCall.id && toolCall.function?.name) {
              // New tool call
              currentToolCall = {
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments || '',
              }
              toolCallBuffer = toolCall.function.arguments || ''
              // console.log(
              //   `🔧 [openrouter] New tool call detected: name=${currentToolCall.name}, id=${currentToolCall.id}`
              // )
            } else if (currentToolCall && toolCall.function?.arguments) {
              // Continue existing tool call
              toolCallBuffer += toolCall.function.arguments
              currentToolCall.arguments = toolCallBuffer
              // console.log(
              //   `🔧 [openrouter] Continuing tool call ${currentToolCall.name}, accumulated buffer length: ${toolCallBuffer.length}`
              // )
            }

            // Try to send complete tool calls
            // Only attempt to parse if buffer appears complete (has closing brace)
            if (currentToolCall && toolCallBuffer && toolCallBuffer.includes('}')) {
              try {
                // Try to parse as JSON first
                // console.log(
                //   `🔧 [openrouter] Attempting to parse toolCallBuffer: ${toolCallBuffer.substring(0, 100)}...`
                // )
                JSON.parse(toolCallBuffer)
                const toolCallData = {
                  id: currentToolCall.id,
                  name: currentToolCall.name,
                  arguments: toolCallBuffer,
                }

                // console.log(`✅ [openrouter] Tool call JSON parsed successfully. tool_detail=${tool_detail}`)
                // console.log(`✅ [openrouter] toolCallData to send:`, JSON.stringify(toolCallData))

                // Send structured tool call data to client
                const toolCallEvent = {
                  part: 'tool_call',
                  toolCall: {
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    arguments: JSON.parse(toolCallBuffer),
                    status: 'pending' as const,
                  },
                }

                // console.log(`✅ [openrouter] Sending tool call event:`, JSON.stringify(toolCallEvent).substring(0, 200))
                onChunk(JSON.stringify(toolCallEvent))

                // Add to our tool calls list for execution
                const existingIndex = toolCalls.findIndex(tc => tc.id === currentToolCall.id)
                if (existingIndex >= 0) {
                  toolCalls[existingIndex] = toolCallData
                } else {
                  toolCalls.push(toolCallData)
                }
                // console.log(`✅ [openrouter] Tool call added to execution list. Total tool calls: ${toolCalls.length}`)

                // Reset buffer after successful parsing
                toolCallBuffer = ''
              } catch (e) {
                // If JSON parsing fails, check if we have empty object - this might be Grok's issue
                // console.error(`❌ [openrouter] Failed to parse tool call buffer:`, e)
                // console.error(`❌ [openrouter] Buffer content: ${toolCallBuffer}`)
                if (toolCallBuffer === '{}' || !toolCallBuffer.trim()) {
                  // console.log(
                  //   `Warning: Tool call ${currentToolCall.name} has empty arguments, will try to extract from content`
                  // )
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
                  // Reset buffer after handling
                  toolCallBuffer = ''
                }
                // else {
                //   // For other parse errors on supposedly complete JSON, log but don't stop the stream
                //   // console.warn(
                //   //   `⚠️ [openrouter] Tool call JSON incomplete or malformed, continuing to accumulate: ${toolCallBuffer.substring(0, 50)}...`
                //   // )
                // }
              }
            } else if (currentToolCall && toolCallBuffer) {
              // Buffer exists but doesn't have closing brace yet, just keep accumulating
              // Don't attempt to parse - wait for more chunks
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

          // ===================================================================
          // FINISH PROVIDER RUN (mark as succeeded, ready for reconciliation)
          // ===================================================================
          if (currentProviderRunId) {
            await finishProviderRun(currentProviderRunId, 'succeeded', finalUsage)
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

        // console.log(
        //   `Executing ${uniqueToolCalls.length} unique tool calls:`,
        //   uniqueToolCalls.map(tc => tc.name)
        // )

        // Add assistant message with tool calls to conversation
        conversationMessages.push({
          role: 'assistant',
          content: assistantContent || null,
          tool_calls: uniqueToolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        } as any)

        // Check execution mode - if 'client', handle tool routing intelligently
        if (executionMode === 'client') {
          // Tools that require server-side API keys or resources
          // These should NEVER be sent to client for execution
          const SERVER_ONLY_TOOLS = ['brave_search', 'exa_search', 'exa_code_context']

          // Split tools into server-only and client-capable
          const serverOnlyToolCalls = uniqueToolCalls.filter(tc => SERVER_ONLY_TOOLS.includes(tc.name))
          const clientToolCalls = uniqueToolCalls.filter(tc => !SERVER_ONLY_TOOLS.includes(tc.name))

          // Execute server-only tools immediately on the server
          if (serverOnlyToolCalls.length > 0) {
            console.log(
              '⚡ [openrouter] Executing server-only tools in client mode:',
              serverOnlyToolCalls.map(t => t.name)
            )

            for (const toolCall of serverOnlyToolCalls) {
              const result = await executeToolCall(toolCall.name, toolCall.arguments)
              const isError = result.startsWith('Error')

              // Stream tool_result event to client
              onChunk(
                JSON.stringify({
                  part: 'tool_result',
                  toolResult: {
                    tool_use_id: toolCall.id,
                    content: result,
                    is_error: isError,
                  },
                })
              )

              // Add tool result to conversation for next iteration
              conversationMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result,
              } as any)
            }
          }

          // If there are client tools, halt and return for client execution
          if (clientToolCalls.length > 0) {
            // console.log(
            //   '🛑 [openrouter] Client-side execution mode: halting for client tools:',
            //   clientToolCalls.map(t => t.name)
            // )

            // Remove the assistant message we just added (contains ALL tools)
            conversationMessages.pop()

            // Add new assistant message with ONLY client tools
            conversationMessages.push({
              role: 'assistant',
              content: assistantContent || null,
              tool_calls: clientToolCalls.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              })),
            } as any)

            // We still need to log cost for this partial run
            if (!finalUsage) {
              finalUsage = createEstimatedUsage(formattedMessages, assistantContent)
            }
            // Log cost and finish provider run (as succeeded, since it successfully generated the tool call)
            if (currentProviderRunId) {
              await finishProviderRun(currentProviderRunId, 'succeeded', finalUsage)
            }

            // Log generation cost
            try {
              const totals = {
                totalPromptTokens,
                totalCompletionTokens,
                totalReasoningTokens,
                totalCostUSD,
                totalOpenRouterCredits,
              }
              await logGenerationCost(model, stepCount, finalUsage, totals)

              // Update totals
              totalPromptTokens = totals.totalPromptTokens
              totalCompletionTokens = totals.totalCompletionTokens
              totalReasoningTokens = totals.totalReasoningTokens
              totalCostUSD = totals.totalCostUSD
              totalOpenRouterCredits = totals.totalOpenRouterCredits
            } catch (logError) {
              console.error('Error logging generation cost:', logError)
            }

            // Stop the loop and return - client will resume with tool results
            return
          }

          // If ONLY server-only tools, continue the loop to process results
          if (serverOnlyToolCalls.length > 0 && clientToolCalls.length === 0) {
            // console.log('✅ [openrouter] All server-only tools executed, continuing loop')
            // Continue to next step to process tool results
            continue
          }
        }

        // Server execution mode OR no special handling needed
        // Execute all tools and add their results
        for (const toolCall of uniqueToolCalls) {
          const result = await executeToolCall(toolCall.name, toolCall.arguments)
          // console.log(`Tool ${toolCall.name} result:`, result.substring(0, 200) + (result.length > 200 ? '...' : ''))

          // Determine if this is an error result
          const isError = result.startsWith('Error')

          // Stream tool_result event to client
          onChunk(
            JSON.stringify({
              part: 'tool_result',
              toolResult: {
                tool_use_id: toolCall.id,
                content: result,
                is_error: isError,
              },
            })
          )

          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          } as any)
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
        // Mark provider run as aborted
        if (currentProviderRunId) {
          await finishProviderRun(currentProviderRunId, 'aborted', finalUsage)
        }

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
            console.log(`📊 Logged partial cost on abort (error): $${moneyFormat(totals.totalCostUSD)}`)
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
      console.log('provider error', error)

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
        // Mark provider run as failed for non-abort errors
        if (currentProviderRunId) {
          await finishProviderRun(currentProviderRunId, 'failed', finalUsage)
        }

        // Log detailed error information for debugging
        console.error('❌ [openrouter] API Error Details:')
        console.error('  status:', error?.status)
        console.error('  statusText:', error?.statusText)
        console.error('  message:', error?.message)
        console.error('  error.error:', error?.error)
        console.error('  error.error.message:', error?.error?.message)
        console.error('  error.error.type:', error?.error?.type)
        console.error('  error.error.code:', error?.error?.code)
        console.error('  Full error object:', JSON.stringify(error, null, 2).substring(0, 2000))
        console.error('  Message count sent:', formattedMessages.length)

        // Log the last few messages to see what might be wrong
        console.error('  Last 5 messages structure:')
        const lastMessages = formattedMessages.slice(-5)
        for (let i = 0; i < lastMessages.length; i++) {
          const msg = lastMessages[i]
          console.error(
            `    [${formattedMessages.length - 5 + i}] role=${msg.role}, has_tool_calls=${!!msg.tool_calls}, content_type=${typeof msg.content}`
          )
        }

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
      console.log(
        `💾 Saved final cost data for user ${userId}, message ${messageId}: $${moneyFormat(totalCostUSD)} USD`
      )
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
    // console.log('📊 Usage object received:', JSON.stringify(usage, null, 2))

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
  attachments?: Array<{ mimeType?: string; filePath?: string; sha256?: string }>
) {
  const imageAtts = (attachments || []).filter(a => a.filePath || a.sha256)
  if (imageAtts.length === 0) return formattedMessages

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
    formattedMessages.push({ role: 'user', content: '' })
    lastUserIdx = formattedMessages.length - 1
  }

  const parts: any[] = []
  for (const att of imageAtts) {
    try {
      let imageBuffer: Buffer | null = null
      let mediaType = att.mimeType || 'image/jpeg'

      // First, check Redis cache if sha256 is available
      if (att.sha256) {
        const cached = await getCachedAttachmentBase64(att.sha256)
        if (cached) {
          console.log(`Cache hit for attachment sha256:${att.sha256.substring(0, 12)}...`)
          parts.push({ type: 'image_url', image_url: { url: `data:${cached.mimeType};base64,${cached.base64}` } })
          continue // Skip disk/network read
        }
        console.log(`Cache miss for attachment sha256:${att.sha256.substring(0, 12)}...`)
      }

      // Check if filePath is a Supabase Storage URL
      if (att.filePath && att.filePath.startsWith('http')) {
        console.log(`Fetching image from Supabase Storage:${att.filePath}`)

        // Extract the path from the Supabase URL
        // Format: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
        const url = new URL(att.filePath!)
        const pathSegments = url.pathname.split('/')
        const bucketIndex = pathSegments.findIndex(seg => seg === 'public') + 1

        if (bucketIndex > 0 && bucketIndex < pathSegments.length - 1) {
          const bucketName = pathSegments[bucketIndex]
          const objectPath = pathSegments.slice(bucketIndex + 1).join('/')

          // Download the file from Supabase Storage
          const { data, error } = await supabaseAdmin.storage.from(bucketName).download(objectPath)

          if (error) {
            console.error(`Error downloading from Supabase Storage:${error.message}`)
            continue
          }

          if (data) {
            // Convert to buffer
            const arrayBuffer = await data.arrayBuffer()
            imageBuffer = Buffer.from(arrayBuffer)

            // Try to get the mime type from the download response
            const contentType = data.type
            if (contentType && contentType !== 'application/octet-stream') {
              mediaType = contentType
            }

            console.log(`Successfully downloaded image from Supabase:${objectPath}`)
          }
        } else {
          console.error(`Invalid Supabase Storage URL format:${att.filePath}`)
          continue
        }
      } else if (att.filePath) {
        // Try to read as local file (for backwards compatibility)
        console.log(`Attempting to read local file:${att.filePath}`)

        const baseDir = path.resolve(__dirname, '..')
        let abs = path.isAbsolute(att.filePath) ? att.filePath : path.join(baseDir, att.filePath)

        if (!fs.existsSync(abs)) {
          // Try alternative paths
          const candidates = [
            path.resolve(__dirname, '..', 'routes', att.filePath),
            path.resolve(__dirname, att.filePath),
            path.resolve(process.cwd(), att.filePath),
            path.resolve(process.cwd(), 'dist', att.filePath),
            path.resolve(process.cwd(), 'src', att.filePath),
          ]
          const found = candidates.find(p => fs.existsSync(p))
          if (found) {
            abs = found
            console.log(`Resolved attachment path:${abs}`)
          } else {
            console.error(`Local file not found:${att.filePath}`)
            continue
          }
        }

        imageBuffer = fs.readFileSync(abs)
      } else {
        // No filePath and cache miss - skip this attachment
        console.error(`No file path available for attachment with sha256:${att.sha256}`)
        continue
      }

      if (imageBuffer) {
        // Convert to base64
        const base64 = imageBuffer.toString('base64')

        // Add image in OpenAI format
        parts.push({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } })

        console.log(`Successfully processed image attachment:${att.filePath}`)
      }
    } catch (error) {
      console.error(`Error processing attachment${att.filePath}:`, error)
      // Continue with other attachments even if one fails
    }
  }

  // Add images to the last user message
  if (parts.length > 0) {
    const targetMsg = formattedMessages[lastUserIdx]
    const existing = Array.isArray(targetMsg.content)
      ? targetMsg.content
      : [{ type: 'text', text: String(targetMsg.content || '') }]

    formattedMessages[lastUserIdx] = {
      ...targetMsg,
      content: [...existing, ...parts],
    }
  }

  return formattedMessages
}
