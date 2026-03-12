import type { Express } from 'express'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
  getDefaultTools?: () => Array<{ name: string; description?: string; inputSchema?: Record<string, any> }>
}

export function registerTestHarnessRoutes(app: Express, deps: RegisterTestHarnessRoutesDeps): void {
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
}
