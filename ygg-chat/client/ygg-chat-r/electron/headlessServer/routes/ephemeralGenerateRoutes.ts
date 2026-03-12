import type { Express } from 'express'
import { OpenAiChatgptProvider } from '../providers/openaiChatgptProvider.js'
import type { ProviderTokenStore } from '../providers/tokenStore.js'

interface RegisterEphemeralGenerateRoutesDeps {
  tokenStore: ProviderTokenStore
}

type InferenceToolDefinition = {
  name: string
  description?: string
  inputSchema?: Record<string, any>
}

function buildOpenAiResponsesGenerateInput(body: any) {
  const modelName = typeof body.modelName === 'string' && body.modelName.trim() ? body.modelName : 'gpt-5.1-codex-mini'
  const content = typeof body.content === 'string' ? body.content : ''
  const userId = typeof body.userId === 'string' ? body.userId : null
  const history = Array.isArray(body.history) ? body.history : []
  const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : null
  const tools = Array.isArray(body.tools)
    ? body.tools
        .map((tool: any): InferenceToolDefinition | null => {
          if (!tool || typeof tool !== 'object') return null
          const name = typeof tool.name === 'string' ? tool.name.trim() : ''
          if (!name) return null
          return {
            name,
            description: typeof tool.description === 'string' ? tool.description : undefined,
            inputSchema:
              tool.inputSchema && typeof tool.inputSchema === 'object'
                ? tool.inputSchema
                : { type: 'object', properties: {} },
          }
        })
        .filter((tool): tool is InferenceToolDefinition => Boolean(tool))
    : undefined

  return {
    modelName,
    content,
    userId,
    history,
    systemPrompt,
    tools,
    accessToken: typeof body.accessToken === 'string' ? body.accessToken : null,
    accountId: typeof body.accountId === 'string' ? body.accountId : null,
  }
}

async function runOpenAiResponsesGenerate(openAiProvider: OpenAiChatgptProvider, body: any) {
  const parsed = buildOpenAiResponsesGenerateInput(body)

  if (!parsed.content.trim()) {
    return { error: 'content is required', status: 400 as const }
  }

  const generated = await openAiProvider.generate({
    modelName: parsed.modelName,
    userContent: parsed.content,
    history: parsed.history,
    userId: parsed.userId,
    accessToken: parsed.accessToken,
    accountId: parsed.accountId,
    systemPrompt: parsed.systemPrompt,
    tools: parsed.tools,
  })

  return {
    status: 200 as const,
    payload: {
      success: true,
      provider: 'openaichatgpt',
      upstream: 'responses',
      modelName: parsed.modelName,
      message: { role: 'assistant', content: generated.content },
      reasoning: generated.reasoning || null,
      toolCalls: generated.toolCalls || [],
      contentBlocks: generated.contentBlocks || [],
      raw: generated.raw || null,
    },
  }
}

function registerGenerateHandler(app: Express, endpoint: string, openAiProvider: OpenAiChatgptProvider): void {
  app.post(endpoint, async (req, res) => {
    try {
      const result = await runOpenAiResponsesGenerate(openAiProvider, req.body ?? {})
      if ('error' in result) {
        res.status(result.status).json({ success: false, error: result.error })
        return
      }
      res.status(result.status).json(result.payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ success: false, error: message })
    }
  })
}

function registerYggHookGenerateRoute(app: Express, openAiProvider: OpenAiChatgptProvider): void {
  app.post('/api/headless/ygg-hooks/generate', async (req, res) => {
    try {
      const body = req.body ?? {}
      const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : 'openai'
      if (provider && provider !== 'openai' && provider !== 'openaichatgpt') {
        res.status(400).json({ success: false, error: 'Only openai/openaichatgpt is supported for ygg hook generation.' })
        return
      }

      const result = await runOpenAiResponsesGenerate(openAiProvider, {
        modelName: body.modelName,
        content: body.content,
        systemPrompt: body.systemPrompt,
        history: Array.isArray(body.history) ? body.history : [],
        userId: typeof body.userId === 'string' ? body.userId : null,
        accessToken: typeof body.accessToken === 'string' ? body.accessToken : null,
        accountId: typeof body.accountId === 'string' ? body.accountId : null,
      })

      if ('error' in result) {
        res.status(result.status).json({ success: false, error: result.error })
        return
      }

      res.status(200).json({
        success: true,
        provider: 'openaichatgpt',
        modelName: result.payload.modelName,
        text: result.payload.message?.content || '',
        message: result.payload.message,
        raw: result.payload.raw || null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.status(500).json({ success: false, error: message })
    }
  })
}

export function registerEphemeralGenerateRoutes(app: Express, deps: RegisterEphemeralGenerateRoutesDeps): void {
  const openAiProvider = new OpenAiChatgptProvider({ tokenStore: deps.tokenStore })

  registerGenerateHandler(app, '/api/headless/provider/openai/responses', openAiProvider)
  registerGenerateHandler(app, '/api/headless/ephemeral/chat', openAiProvider)
  registerYggHookGenerateRoute(app, openAiProvider)
}
