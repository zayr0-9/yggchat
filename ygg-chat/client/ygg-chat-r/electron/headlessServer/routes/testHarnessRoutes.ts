import type { Express } from 'express'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OpenAiChatgptProvider } from '../providers/openaiChatgptProvider.js'
import type { ProviderTokenStore } from '../providers/tokenStore.js'
import { TEST_HARNESS_CLIENT_JS } from './testHarnessClientScript.js'

const loadTestHarnessHtml = (): string => {
  const candidatePaths: string[] = []

  try {
    candidatePaths.push(fileURLToPath(new URL('./testHarnessPage.html', import.meta.url)))
  } catch {
    // Ignore malformed URL conversion and try additional locations.
  }

  try {
    candidatePaths.push(fileURLToPath(new URL('./headlessServer/routes/testHarnessPage.html', import.meta.url)))
  } catch {
    // Ignore malformed URL conversion and try additional locations.
  }

  candidatePaths.push(
    path.resolve(process.cwd(), 'electron', 'headlessServer', 'routes', 'testHarnessPage.html'),
    path.resolve(process.cwd(), 'headlessServer', 'routes', 'testHarnessPage.html')
  )

  for (const candidatePath of candidatePaths) {
    try {
      if (!existsSync(candidatePath)) continue
      return readFileSync(candidatePath, 'utf8')
    } catch {
      // Fall through and try the next location.
    }
  }

  throw new Error(`Unable to load testHarnessPage.html. Checked: ${candidatePaths.join(', ')}`)
}

const TEST_HARNESS_HTML = loadTestHarnessHtml()

interface RegisterTestHarnessRoutesDeps {
  tokenStore: ProviderTokenStore
  getDefaultTools?: () => Array<{ name: string; description?: string; inputSchema?: Record<string, any> }>
}

export function registerTestHarnessRoutes(app: Express, deps: RegisterTestHarnessRoutesDeps): void {
  const openAiProvider = new OpenAiChatgptProvider({ tokenStore: deps.tokenStore })

  app.get('/headless/openai-test', (_req, res) => {
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.send(TEST_HARNESS_HTML)
  })

  app.get('/api/headless/ephemeral/harness.js', (_req, res) => {
    res.status(200).setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.send(TEST_HARNESS_CLIENT_JS)
  })

  app.get('/api/headless/ephemeral/tools', (_req, res) => {
    const tools = (deps.getDefaultTools?.() || []).map(tool => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    }))

    res.json({ success: true, count: tools.length, tools })
  })

  const buildGenerateInput = (body: any) => {
    const modelName =
      typeof body.modelName === 'string' && body.modelName.trim() ? body.modelName : 'gpt-5.1-codex-mini'
    const content = typeof body.content === 'string' ? body.content : ''
    const userId = typeof body.userId === 'string' ? body.userId : null
    const history = Array.isArray(body.history) ? body.history : []
    const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt : null
    const tools = Array.isArray(body.tools)
      ? body.tools
          .map((tool: any) => {
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
          .filter(
            (
              tool: { name: string; description?: string; inputSchema?: Record<string, any> } | null
            ): tool is { name: string; description?: string; inputSchema?: Record<string, any> } => Boolean(tool)
          )
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

  const runOpenAiResponsesGenerate = async (body: any) => {
    const parsed = buildGenerateInput(body)

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

  app.post('/api/headless/provider/openai/responses', async (req, res) => {
    try {
      const result = await runOpenAiResponsesGenerate(req.body ?? {})
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

  // Backward compatibility alias while harness is evolving.
  app.post('/api/headless/ephemeral/chat', async (req, res) => {
    try {
      const result = await runOpenAiResponsesGenerate(req.body ?? {})
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
