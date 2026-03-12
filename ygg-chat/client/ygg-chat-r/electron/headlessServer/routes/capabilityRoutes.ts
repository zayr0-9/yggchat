import type { Express } from 'express'

interface RegisterCapabilityRoutesDeps {
  getDefaultTools: () => Array<{ name: string; description?: string }>
}

export function registerCapabilityRoutes(app: Express, deps: RegisterCapabilityRoutesDeps): void {
  const buildPayload = () => ({
    success: true,
    apiVersion: 'v1',
    chat: {
      operations: ['send', 'repeat', 'branch', 'edit-branch'],
      sseEvents: [
        'started',
        'user_message_persisted',
        'provider_routed',
        'tool_loop',
        'tool_execution',
        'chunk:text',
        'chunk:reasoning',
        'chunk:tool_call',
        'chunk:tool_result',
        'assistant_message_persisted',
        'complete',
        'error',
      ],
      routes: {
        send: '/api/conversations/:id/messages',
        repeat: '/api/conversations/:id/messages/repeat',
        branch: '/api/conversations/:id/messages/:messageId/branch',
        editBranch: '/api/conversations/:id/messages/:messageId/edit-branch',
      },
    },
    providers: [
      { name: 'openaichatgpt', auth: 'oauth_or_token' },
      { name: 'openrouter', auth: 'app_bearer' },
      { name: 'lmstudio', auth: 'local_or_bearer' },
    ],
    tools: deps.getDefaultTools().map(tool => ({ name: tool.name, description: tool.description || '' })),
  })

  app.get('/api/headless/capabilities', (_req, res) => {
    res.json(buildPayload())
  })

  app.get('/api/v1/capabilities', (_req, res) => {
    res.json(buildPayload())
  })
}
