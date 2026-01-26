// electron/mcp/mcpRoutes.ts
// Express routes for MCP server management

import { Express } from 'express'
import { mcpManager, McpServerConfig } from './mcpManager.js'
import { toolOrchestrator } from '../tools/orchestrator/index.js'

// Helper function to refresh MCP tools with the orchestrator
async function refreshMcpToolsWithOrchestrator(): Promise<number> {
  const mcpTools = mcpManager.getAllTools()
  let registeredCount = 0

  for (const mcpTool of mcpTools) {
    const qualifiedName = mcpTool.qualifiedName || mcpTool.name

    // Check if already registered (orchestrator might have a method for this)
    // For now, just register (re-registration should be idempotent)
    toolOrchestrator.registerTool(qualifiedName, async (args, _options) => {
      try {
        const mcpResult = await mcpManager.callTool(qualifiedName, args)
        const textContent = mcpResult.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('\n')
        return {
          success: !mcpResult.isError,
          content: mcpResult.content,
          text: textContent,
          error: mcpResult.isError ? textContent : undefined,
        }
      } catch (error) {
        console.error(`[McpRoutes] MCP tool execution error (${qualifiedName}):`, error)
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
    registeredCount++
  }

  console.log(`[McpRoutes] Refreshed ${registeredCount} MCP tools with orchestrator`)
  return registeredCount
}

export function registerMcpRoutes(app: Express): void {

  // GET /api/mcp/status - Get status of all MCP servers
  app.get('/api/mcp/status', async (_req, res) => {
    try {
      await mcpManager.initialize()
      const status = mcpManager.getStatus()
      res.json({
        success: true,
        servers: status,
        totalConnected: status.filter(s => s.status === 'connected').length,
      })
    } catch (error) {
      console.error('[McpRoutes] Error getting status:', error)
      res.status(500).json({ success: false, error: 'Failed to get MCP status' })
    }
  })

  // GET /api/mcp/servers - List all configured MCP servers
  app.get('/api/mcp/servers', async (_req, res) => {
    try {
      await mcpManager.initialize()
      const configs = await mcpManager.getConfigs()
      const status = mcpManager.getStatus()

      // Merge config with status
      const servers = configs.map(config => {
        const serverStatus = status.find(s => s.name === config.name)
        return {
          ...config,
          status: serverStatus?.status || 'disconnected',
          error: serverStatus?.error,
          toolCount: serverStatus?.tools.length || 0,
          resourceCount: serverStatus?.resources.length || 0,
          promptCount: serverStatus?.prompts.length || 0,
        }
      })

      res.json({ success: true, servers })
    } catch (error) {
      console.error('[McpRoutes] Error listing servers:', error)
      res.status(500).json({ success: false, error: 'Failed to list MCP servers' })
    }
  })

  // GET /api/mcp/servers/:name - Get status of specific server
  app.get('/api/mcp/servers/:name', async (req, res) => {
    try {
      await mcpManager.initialize()
      const status = mcpManager.getServerStatus(req.params.name)

      if (!status) {
        res.status(404).json({ success: false, error: 'Server not found' })
        return
      }

      res.json({ success: true, server: status })
    } catch (error) {
      console.error('[McpRoutes] Error getting server status:', error)
      res.status(500).json({ success: false, error: 'Failed to get server status' })
    }
  })

  // POST /api/mcp/servers - Add a new MCP server
  app.post('/api/mcp/servers', async (req, res) => {
    try {
      await mcpManager.initialize()
      const { name, command, args, env, enabled, autoStart } = req.body

      if (!name || typeof name !== 'string') {
        res.status(400).json({ success: false, error: 'Missing "name" in request body' })
        return
      }

      if (!command || typeof command !== 'string') {
        res.status(400).json({ success: false, error: 'Missing "command" in request body' })
        return
      }

      if (!Array.isArray(args)) {
        res.status(400).json({ success: false, error: '"args" must be an array' })
        return
      }

      // Validate name format (lowercase, alphanumeric, hyphens)
      if (!/^[a-z][a-z0-9-]*$/.test(name)) {
        res.status(400).json({ success: false, error: 'Server name must be lowercase alphanumeric with hyphens' })
        return
      }

      const config: McpServerConfig = {
        name,
        command,
        args,
        env: env || {},
        enabled: enabled !== false,
        autoStart: autoStart !== false,
      }

      await mcpManager.addServer(config)

      // Refresh MCP tools with orchestrator after server is added (and auto-started)
      const toolCount = await refreshMcpToolsWithOrchestrator()
      res.json({ success: true, message: `Server '${name}' added`, toolsRegistered: toolCount })
    } catch (error) {
      console.error('[McpRoutes] Error adding server:', error)
      const message = error instanceof Error ? error.message : 'Failed to add MCP server'
      res.status(400).json({ success: false, error: message })
    }
  })

  // PUT /api/mcp/servers/:name - Update an MCP server config
  app.put('/api/mcp/servers/:name', async (req, res) => {
    try {
      await mcpManager.initialize()
      const { command, args, env, enabled, autoStart } = req.body

      const updates: Partial<McpServerConfig> = {}
      if (command !== undefined) updates.command = command
      if (args !== undefined) updates.args = args
      if (env !== undefined) updates.env = env
      if (enabled !== undefined) updates.enabled = enabled
      if (autoStart !== undefined) updates.autoStart = autoStart

      await mcpManager.updateServer(req.params.name, updates)

      res.json({ success: true, message: `Server '${req.params.name}' updated` })
    } catch (error) {
      console.error('[McpRoutes] Error updating server:', error)
      const message = error instanceof Error ? error.message : 'Failed to update MCP server'
      res.status(400).json({ success: false, error: message })
    }
  })

  // DELETE /api/mcp/servers/:name - Remove an MCP server
  app.delete('/api/mcp/servers/:name', async (req, res) => {
    try {
      await mcpManager.initialize()
      await mcpManager.removeServer(req.params.name)
      res.json({ success: true, message: `Server '${req.params.name}' removed` })
    } catch (error) {
      console.error('[McpRoutes] Error removing server:', error)
      const message = error instanceof Error ? error.message : 'Failed to remove MCP server'
      res.status(400).json({ success: false, error: message })
    }
  })

  // POST /api/mcp/servers/:name/start - Start an MCP server
  app.post('/api/mcp/servers/:name/start', async (req, res) => {
    try {
      await mcpManager.initialize()
      const configs = await mcpManager.getConfigs()
      const config = configs.find(c => c.name === req.params.name)

      if (!config) {
        res.status(404).json({ success: false, error: 'Server not found' })
        return
      }

      await mcpManager.startServer(config)
      // Refresh MCP tools with orchestrator after server starts
      const toolCount = await refreshMcpToolsWithOrchestrator()
      res.json({ success: true, message: `Server '${req.params.name}' started`, toolsRegistered: toolCount })
    } catch (error) {
      console.error('[McpRoutes] Error starting server:', error)
      const message = error instanceof Error ? error.message : 'Failed to start MCP server'
      res.status(400).json({ success: false, error: message })
    }
  })

  // POST /api/mcp/servers/:name/stop - Stop an MCP server
  app.post('/api/mcp/servers/:name/stop', async (req, res) => {
    try {
      await mcpManager.initialize()
      await mcpManager.stopServer(req.params.name)
      res.json({ success: true, message: `Server '${req.params.name}' stopped` })
    } catch (error) {
      console.error('[McpRoutes] Error stopping server:', error)
      const message = error instanceof Error ? error.message : 'Failed to stop MCP server'
      res.status(400).json({ success: false, error: message })
    }
  })

  // POST /api/mcp/servers/:name/restart - Restart an MCP server
  app.post('/api/mcp/servers/:name/restart', async (req, res) => {
    try {
      await mcpManager.initialize()
      await mcpManager.restartServer(req.params.name)
      res.json({ success: true, message: `Server '${req.params.name}' restarted` })
    } catch (error) {
      console.error('[McpRoutes] Error restarting server:', error)
      const message = error instanceof Error ? error.message : 'Failed to restart MCP server'
      res.status(400).json({ success: false, error: message })
    }
  })

  // ============================================================================
  // Tool routes
  // ============================================================================

  // GET /api/mcp/tools - Get all tools from connected MCP servers
  app.get('/api/mcp/tools', async (_req, res) => {
    try {
      await mcpManager.initialize()
      const tools = mcpManager.getAllTools()
      res.json({
        success: true,
        tools,
        totalCount: tools.length,
      })
    } catch (error) {
      console.error('[McpRoutes] Error getting tools:', error)
      res.status(500).json({ success: false, error: 'Failed to get MCP tools' })
    }
  })

  // POST /api/mcp/tools/call - Call an MCP tool
  app.post('/api/mcp/tools/call', async (req, res) => {
    try {
      await mcpManager.initialize()
      const { name, arguments: args } = req.body

      if (!name || typeof name !== 'string') {
        res.status(400).json({ success: false, error: 'Missing "name" in request body' })
        return
      }

      const result = await mcpManager.callTool(name, args || {})

      res.json({
        success: true,
        result,
      })
    } catch (error) {
      console.error('[McpRoutes] Error calling tool:', error)
      const message = error instanceof Error ? error.message : 'Failed to call MCP tool'
      res.status(400).json({ success: false, error: message })
    }
  })

  // ============================================================================
  // Resource routes
  // ============================================================================

  // GET /api/mcp/resources - Get all resources from connected MCP servers
  app.get('/api/mcp/resources', async (_req, res) => {
    try {
      await mcpManager.initialize()
      const resources = mcpManager.getAllResources()
      res.json({
        success: true,
        resources,
        totalCount: resources.length,
      })
    } catch (error) {
      console.error('[McpRoutes] Error getting resources:', error)
      res.status(500).json({ success: false, error: 'Failed to get MCP resources' })
    }
  })

  // POST /api/mcp/resources/read - Read an MCP resource
  app.post('/api/mcp/resources/read', async (req, res) => {
    try {
      await mcpManager.initialize()
      const { serverName, uri } = req.body

      if (!serverName || !uri) {
        res.status(400).json({ success: false, error: 'Missing "serverName" or "uri" in request body' })
        return
      }

      const result = await mcpManager.readResource(serverName, uri)

      res.json({
        success: true,
        result,
      })
    } catch (error) {
      console.error('[McpRoutes] Error reading resource:', error)
      const message = error instanceof Error ? error.message : 'Failed to read MCP resource'
      res.status(400).json({ success: false, error: message })
    }
  })

  // ============================================================================
  // Prompt routes
  // ============================================================================

  // GET /api/mcp/prompts - Get all prompts from connected MCP servers
  app.get('/api/mcp/prompts', async (_req, res) => {
    try {
      await mcpManager.initialize()
      const prompts = mcpManager.getAllPrompts()
      res.json({
        success: true,
        prompts,
        totalCount: prompts.length,
      })
    } catch (error) {
      console.error('[McpRoutes] Error getting prompts:', error)
      res.status(500).json({ success: false, error: 'Failed to get MCP prompts' })
    }
  })

  // POST /api/mcp/prompts/get - Get a specific prompt with arguments
  app.post('/api/mcp/prompts/get', async (req, res) => {
    try {
      await mcpManager.initialize()
      const { serverName, name, arguments: args } = req.body

      if (!serverName || !name) {
        res.status(400).json({ success: false, error: 'Missing "serverName" or "name" in request body' })
        return
      }

      const result = await mcpManager.getPrompt(serverName, name, args)

      res.json({
        success: true,
        result,
      })
    } catch (error) {
      console.error('[McpRoutes] Error getting prompt:', error)
      const message = error instanceof Error ? error.message : 'Failed to get MCP prompt'
      res.status(400).json({ success: false, error: message })
    }
  })

  // ============================================================================
  // Config path
  // ============================================================================

  // GET /api/mcp/config-path - Get the MCP config file path
  app.get('/api/mcp/config-path', async (_req, res) => {
    try {
      const configPath = mcpManager.getConfigPath()
      res.json({ success: true, configPath })
    } catch (error) {
      console.error('[McpRoutes] Error getting config path:', error)
      res.status(500).json({ success: false, error: 'Failed to get config path' })
    }
  })

  // POST /api/mcp/refresh-tools - Refresh MCP tools with the orchestrator
  app.post('/api/mcp/refresh-tools', async (_req, res) => {
    try {
      await mcpManager.initialize()
      const toolCount = await refreshMcpToolsWithOrchestrator()
      res.json({ success: true, message: `Registered ${toolCount} MCP tools with orchestrator`, toolCount })
    } catch (error) {
      console.error('[McpRoutes] Error refreshing tools:', error)
      res.status(500).json({ success: false, error: 'Failed to refresh MCP tools' })
    }
  })

  console.log('[McpRoutes] Registered MCP routes')
}
