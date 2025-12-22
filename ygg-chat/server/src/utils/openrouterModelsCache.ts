import { LRUCache } from 'lru-cache'
import { redisClient } from '../config/redis'

const OPENROUTER_MODELS_CACHE_KEY = 'openrouter:models:list'
const OPENROUTER_MODELS_TTL_SECONDS = 30 * 60 // 30 minutes

export interface OpenRouterModel {
  id: string
  name: string
  version: string
  displayName: string
  description: string
  contextLength: number
  maxCompletionTokens: number
  inputTokenLimit: number
  outputTokenLimit: number
  promptCost: number
  completionCost: number
  requestCost: number
  thinking: boolean
  supportsImages: boolean
  supportsWebSearch: boolean
  supportsStructuredOutputs: boolean
  inputModalities: string[]
  outputModalities: string[]
  defaultTemperature: number | null
  defaultTopP: number | null
  defaultFrequencyPenalty: number | null
  topProviderContextLength: number | null
  supportedGenerationMethods: string[]
}

const modelsMemoryCache = new LRUCache<string, OpenRouterModel[]>({
  max: 1, // Cache up to 50 API key entries
  ttl: 1000 * 60 * 30, // 30 minutes (matches Redis TTL)
  allowStale: false,
  updateAgeOnGet: true, // Refresh TTL on access (LRU behavior)
})

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ''

//update function
export async function getCachedOpenRouterModels(): Promise<OpenRouterModel[]> {
  const cacheKey = 'openrouter_models'

  try {
    //1. Check in memory cache
    let models = modelsMemoryCache.get(cacheKey)
    if (models) {
      // console.log(`[OpenRouter Models]🧠 Memory cache hit - ${models.length} models`)
      return models
    }
    // 2. Check Redis cache
    const cached = await redisClient.get(OPENROUTER_MODELS_CACHE_KEY)
    if (cached) {
      models = JSON.parse(cached) as OpenRouterModel[]
      console.log(`[OpenRouter Models]💾 Redis -> Memory cache - ${models.length} models`)
      return models
    }
  } catch (cacheError) {
    console.error('[OpenRouter Models] Cache read error:', cacheError)
  }

  // 3. Cache miss - fetch from API
  console.log('[OpenRouter Models] 🌐 Cache miss - fetching from OpenRouter API')
  const models = await fetchModelsFromAPI(OPENROUTER_API_KEY)

  //4 update both caches
  try {
    modelsMemoryCache.set(cacheKey, models)
    await redisClient.set(OPENROUTER_MODELS_CACHE_KEY, JSON.stringify(models), 'EX', OPENROUTER_MODELS_TTL_SECONDS)
  } catch (cacheError) {
    console.error('[OpenRouter Models] Cache write error:', cacheError)
  }
  return models
}

/**
 * Transform raw OpenRouter API model data into our normalized format
 */
function transformModel(m: any): OpenRouterModel | null {
  const rawId = String(m?.id || m?.name || '')
  const name = rawId.replace(/^models\//, '')
  if (!name) return null

  const displayName = String(m?.display_name || m?.displayName || name)
  const description = String(m?.description || '')
  const inputTokenLimit = Number(m?.context_length ?? m?.context_length_tokens ?? 0)
  const outputTokenLimit = Number(m?.output_token_limit ?? m?.max_output_tokens ?? 0)
  const supportedParams: string[] = Array.isArray(m?.supported_parameters) ? m.supported_parameters : []
  const capabilities = (m as any)?.capabilities || {}

  const thinking =
    supportedParams.includes('reasoning') ||
    supportedParams.includes('include_reasoning') ||
    !!capabilities?.reasoning ||
    /thinking/i.test(name) ||
    /thinking/i.test(displayName)

  // Extract pricing information
  const promptCost = Number(m?.pricing?.prompt ?? 0)
  const completionCost = Number(m?.pricing?.completion ?? 0)
  const requestCost = Number(m?.pricing?.request ?? 0)

  // Extract modality support from architecture object
  const inputModalities: string[] = Array.isArray(m?.architecture?.input_modalities)
    ? m.architecture.input_modalities
    : m?.supports_vision
      ? ['text', 'image']
      : ['text']
  const outputModalities: string[] = Array.isArray(m?.architecture?.output_modalities)
    ? m.architecture.output_modalities
    : m?.supports_vision
      ? ['text', 'image']
      : ['text']

  // Extract default parameters
  const defaultTemperature = m?.top_level_parameters?.temperature ?? null
  const defaultTopP = m?.top_level_parameters?.top_p ?? null
  const defaultFrequencyPenalty = m?.top_level_parameters?.frequency_penalty ?? null

  // Extract context and completion limits
  const contextLength = inputTokenLimit
  const maxCompletionTokens = outputTokenLimit
  const topProviderContextLength = Number(m?.top_provider?.context_length ?? null) || null

  return {
    id: rawId,
    name,
    version: String(m?.version || ''),
    displayName,
    description,
    contextLength,
    maxCompletionTokens,
    inputTokenLimit,
    outputTokenLimit,
    promptCost,
    completionCost,
    requestCost,
    thinking,
    supportsImages: !!m?.supports_vision || inputModalities.includes('image'),
    supportsWebSearch: !!capabilities?.web_search || supportedParams.includes('web_search'),
    supportsStructuredOutputs: !!capabilities?.structured_outputs || supportedParams.includes('structured_outputs'),
    inputModalities,
    outputModalities,
    defaultTemperature,
    defaultTopP,
    defaultFrequencyPenalty,
    topProviderContextLength,
    supportedGenerationMethods: supportedParams,
  }
}

/**
 * Fetch models from OpenRouter API and transform them
 */
async function fetchModelsFromAPI(apiKey: string): Promise<OpenRouterModel[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenRouter API error: ${response.status} ${text || response.statusText}`)
  }

  const data = (await response.json()) as { data?: any[]; models?: any[] }
  const rawModels: any[] = Array.isArray(data?.data) ? data.data! : Array.isArray(data?.models) ? data.models! : []

  return rawModels.map(transformModel).filter((m): m is OpenRouterModel => m !== null)
}

/**
 * Get cached OpenRouter models, fetching from API if cache is empty or expired
 */
// export async function getCachedOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
//   try {
//     // Try to get from cache first
//     const cached = await redisClient.get(OPENROUTER_MODELS_CACHE_KEY)
//     if (cached) {
//       const models = JSON.parse(cached) as OpenRouterModel[]
//       console.log(`[OpenRouter Models] Cache hit - ${models.length} models`)
//       return models
//     }
//   } catch (cacheError) {
//     console.error('[OpenRouter Models] Cache read error:', cacheError)
//     // Continue to fetch from API
//   }

//   // Cache miss - fetch from API
//   console.log('[OpenRouter Models] Cache miss - fetching from API')
//   const models = await fetchModelsFromAPI(apiKey)

//   // Store in cache (fire-and-forget)
//   try {
//     await redisClient.set(OPENROUTER_MODELS_CACHE_KEY, JSON.stringify(models), 'EX', OPENROUTER_MODELS_TTL_SECONDS)
//     console.log(`[OpenRouter Models] Cached ${models.length} models (TTL: ${OPENROUTER_MODELS_TTL_SECONDS}s)`)
//   } catch (cacheError) {
//     console.error('[OpenRouter Models] Cache write error:', cacheError)
//   }

//   return models
// }

/**
 * Get a specific model by ID or name from cache
 */
export async function getCachedModelById(apiKey: string, modelId: string): Promise<OpenRouterModel | null> {
  const models = await getCachedOpenRouterModels()
  let found = models.find(m => m.id === modelId || m.name === modelId) || null
  return found
}

/**
 * Get model parameters for inference (contextLength, maxCompletionTokens, etc.)
 */
export async function getModelParameters(
  apiKey: string,
  modelId: string
): Promise<{
  contextLength: number
  maxCompletionTokens: number
  supportsImages: boolean
  thinking: boolean
  defaultTemperature: number | null
} | null> {
  const model = await getCachedModelById(apiKey, modelId)
  if (!model) return null

  return {
    contextLength: model.contextLength,
    maxCompletionTokens: model.maxCompletionTokens,
    supportsImages: model.supportsImages,
    thinking: model.thinking,
    defaultTemperature: model.defaultTemperature,
  }
}

/**
 * Invalidate the models cache (useful after model list updates)
 */
export async function invalidateModelsCache(): Promise<void> {
  try {
    await redisClient.del(OPENROUTER_MODELS_CACHE_KEY)
    console.log('[OpenRouter Models] Cache invalidated')
  } catch (error) {
    console.error('[OpenRouter Models] Cache invalidation error:', error)
  }
}
