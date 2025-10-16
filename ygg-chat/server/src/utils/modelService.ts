interface OllamaModel {
  name: string
}

interface OllamaResponse {
  models: OllamaModel[]
}

const defaultModel: string = 'llama2 (default, is your server working?)'
class ModelService {
  private static instance: ModelService
  private cachedModels: string[] = []
  private defaultModel: string = defaultModel // ultimate fallback
  private lastFetch: number = 0
  private readonly CACHE_TTL = 60000 // 1 minute cache

  private constructor() {}

  static getInstance(): ModelService {
    if (!ModelService.instance) {
      ModelService.instance = new ModelService()
    }
    return ModelService.instance
  }

  async getAvailableModels(): Promise<{ models: string[]; default: string }> {
    const now = Date.now()

    // Return cached if valid, quit function
    if (this.cachedModels.length > 0 && now - this.lastFetch < this.CACHE_TTL) {
      return {
        models: this.cachedModels,
        default: this.defaultModel,
      }
    }

    try {
      //local ollama server replace with your own
      //need to import this from an easily editable json or front end
      const response = await fetch('http://172.31.32.1:11434/api/tags', {
        signal: AbortSignal.timeout(2000), // 5s timeout
      })
      //error, quit function
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`)
      }

      const data = (await response.json()) as OllamaResponse //string[]
      //returns name for each field, makes list liek ["llama2", "codellama", "mistral"]
      const models = data.models.map(m => m.name)

      //no models, quit function
      if (models.length === 0) {
        throw new Error('No models available')
      }

      // Update cache
      this.cachedModels = models
      this.defaultModel = models[0]
      this.lastFetch = now

      return {
        models: this.cachedModels,
        default: this.defaultModel,
      }
    } catch (error) {
      console.error('Failed to fetch models from Ollama:', error)

      // Return cached if available, otherwise fallback
      if (this.cachedModels.length > 0) {
        return {
          models: this.cachedModels,
          default: this.defaultModel,
        }
      }

      // Ultimate fallback
      return {
        models: [defaultModel],
        default: defaultModel,
      }
    }
  }

  async getDefaultModel(): Promise<string> {
    const { default: defaultModel } = await this.getAvailableModels()
    return defaultModel
  }

  // Force refresh cache
  async refreshModels(): Promise<{ models: string[]; default: string }> {
    this.lastFetch = 0
    this.cachedModels = []
    return this.getAvailableModels()
  }
}

//future extension
interface OpenAIModel {
  name: string
}

interface OpenAiResponse {
  models: OpenAIModel[]
}

//class OpenAiModelService {}

//we dont export the whole class, we stick to singleton patter
//anyone who imports modelService, get access to getInstance function only
//getInstance function returns existing ModelService instance if one already exists
//{return ModelService.instance}
export const modelService = ModelService.getInstance()
