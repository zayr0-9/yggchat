// electron/mcp/mcpManager.ts
// MCP (Model Context Protocol) server manager
// Manages connections to MCP servers that provide tools, resources, and prompts

import { app } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { EventEmitter } from 'events'

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
  autoStart?: boolean // Start when app launches (default: true)
}

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, any>
    required?: string[]
  }
  // Added by manager
  serverName?: string
  qualifiedName?: string // mcp__serverName__toolName
}

export interface McpResourceDefinition {
  uri: string
  name?: string
  description?: string
  mimeType?: string
  serverName?: string
}

export interface McpPromptDefinition {
  name: string
  description?: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
  serverName?: string
}

export interface McpToolCallResult {
  content: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
    resource?: { uri: string; mimeType?: string; text?: string }
  }>
  isError?: boolean
}

export interface McpServerStatus {
  name: string
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  tools: McpToolDefinition[]
  resources: McpResourceDefinition[]
  prompts: McpPromptDefinition[]
  pid?: number
}

// JSON-RPC message types
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: any
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: any
  error?: { code: number; message: string; data?: any }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

// ============================================================================
// MCP Client - Handles communication with a single MCP server
// ============================================================================

class McpClient extends EventEmitter {
  private process: ChildProcess | null = null
  private requestId = 0
  private pendingRequests: Map<number | string, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }> = new Map()
  private buffer = ''

  public status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected'
  public error?: string
  public tools: McpToolDefinition[] = []
  public resources: McpResourceDefinition[] = []
  public prompts: McpPromptDefinition[] = []

  constructor(
    public readonly name: string,
    public readonly config: McpServerConfig
  ) {
    super()
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return
    }

    this.status = 'connecting'
    this.error = undefined
    this.emit('statusChange', this.status)

    try {
      // Spawn the MCP server process
      const env = { ...process.env, ...this.config.env }

      this.process = spawn(this.config.command, this.config.args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      })

      // Handle stdout (JSON-RPC messages)
      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data.toString())
      })

      // Handle stderr (logging)
      this.process.stderr?.on('data', (data: Buffer) => {
        console.log(`[MCP:${this.name}] stderr:`, data.toString().trim())
      })

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        console.log(`[MCP:${this.name}] Process exited with code ${code}, signal ${signal}`)
        this.status = 'disconnected'
        this.process = null
        this.emit('statusChange', this.status)
        this.rejectAllPending(new Error('MCP server process exited'))
      })

      this.process.on('error', (err) => {
        console.error(`[MCP:${this.name}] Process error:`, err)
        this.status = 'error'
        this.error = err.message
        this.emit('statusChange', this.status)
      })

      // Initialize the connection
      await this.initialize()

      // Fetch capabilities
      await this.refreshCapabilities()

      this.status = 'connected'
      this.emit('statusChange', this.status)
      console.log(`[MCP:${this.name}] Connected successfully`)

    } catch (err) {
      this.status = 'error'
      this.error = err instanceof Error ? err.message : String(err)
      this.emit('statusChange', this.status)
      this.disconnect()
      throw err
    }
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM')

      // Force kill after timeout
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL')
        }
      }, 5000)
    }

    this.process = null
    this.status = 'disconnected'
    this.tools = []
    this.resources = []
    this.prompts = []
    this.rejectAllPending(new Error('Disconnected'))
    this.emit('statusChange', this.status)
  }

  async callTool(toolName: string, args: any): Promise<McpToolCallResult> {
    const response = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args,
    })
    return response as McpToolCallResult
  }

  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    const response = await this.sendRequest('resources/read', { uri })
    return response
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<{ description?: string; messages: Array<{ role: string; content: any }> }> {
    const response = await this.sendRequest('prompts/get', { name, arguments: args })
    return response
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private async initialize(): Promise<void> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
      },
      clientInfo: {
        name: 'ygg-chat',
        version: '1.0.0',
      },
    })

    console.log(`[MCP:${this.name}] Initialized with server:`, result.serverInfo?.name)

    // Send initialized notification
    this.sendNotification('notifications/initialized', {})
  }

  private async refreshCapabilities(): Promise<void> {
    // Fetch tools
    try {
      const toolsResult = await this.sendRequest('tools/list', {})
      this.tools = (toolsResult.tools || []).map((tool: McpToolDefinition) => ({
        ...tool,
        serverName: this.name,
        qualifiedName: `mcp__${this.name}__${tool.name}`,
      }))
      console.log(`[MCP:${this.name}] Loaded ${this.tools.length} tools`)
    } catch (err) {
      console.log(`[MCP:${this.name}] No tools available:`, err)
      this.tools = []
    }

    // Fetch resources
    try {
      const resourcesResult = await this.sendRequest('resources/list', {})
      this.resources = (resourcesResult.resources || []).map((r: McpResourceDefinition) => ({
        ...r,
        serverName: this.name,
      }))
      console.log(`[MCP:${this.name}] Loaded ${this.resources.length} resources`)
    } catch (err) {
      console.log(`[MCP:${this.name}] No resources available`)
      this.resources = []
    }

    // Fetch prompts
    try {
      const promptsResult = await this.sendRequest('prompts/list', {})
      this.prompts = (promptsResult.prompts || []).map((p: McpPromptDefinition) => ({
        ...p,
        serverName: this.name,
      }))
      console.log(`[MCP:${this.name}] Loaded ${this.prompts.length} prompts`)
    } catch (err) {
      console.log(`[MCP:${this.name}] No prompts available`)
      this.prompts = []
    }
  }

  private handleData(data: string): void {
    this.buffer += data

    // Process complete messages (newline-delimited JSON)
    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      if (line) {
        try {
          const message = JSON.parse(line)
          this.handleMessage(message)
        } catch (err) {
          console.error(`[MCP:${this.name}] Failed to parse message:`, line, err)
        }
      }
    }
  }

  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    // Check if it's a response (has id)
    if ('id' in message && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(message.id)

        if ('error' in message && message.error) {
          pending.reject(new Error(message.error.message))
        } else {
          pending.resolve(message.result)
        }
      }
    } else if ('method' in message) {
      // It's a notification
      this.handleNotification(message as JsonRpcNotification)
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    console.log(`[MCP:${this.name}] Notification:`, notification.method)

    switch (notification.method) {
      case 'notifications/tools/list_changed':
        this.refreshCapabilities()
        break
      case 'notifications/resources/list_changed':
        this.refreshCapabilities()
        break
      case 'notifications/prompts/list_changed':
        this.refreshCapabilities()
        break
    }
  }

  private sendRequest(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP server not connected'))
        return
      }

      const id = ++this.requestId
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timed out: ${method}`))
      }, 30000)

      this.pendingRequests.set(id, { resolve, reject, timeout })

      const message = JSON.stringify(request) + '\n'
      this.process.stdin.write(message)
    })
  }

  private sendNotification(method: string, params?: any): void {
    if (!this.process?.stdin) return

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }

    const message = JSON.stringify(notification) + '\n'
    this.process.stdin.write(message)
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  getStatus(): McpServerStatus {
    return {
      name: this.name,
      status: this.status,
      error: this.error,
      tools: this.tools,
      resources: this.resources,
      prompts: this.prompts,
      pid: this.process?.pid,
    }
  }
}

// ============================================================================
// MCP Manager - Orchestrates multiple MCP server connections
// ============================================================================

const MCP_CONFIG_FILE = 'mcp-servers.json'

interface McpConfigFile {
  servers: Record<string, Omit<McpServerConfig, 'name' | 'enabled'> & { enabled?: boolean }>
}

class McpManager extends EventEmitter {
  private clients: Map<string, McpClient> = new Map()
  private configPath: string = ''
  private initialized = false
  private initPromise: Promise<void> | null = null

  getConfigDirectory(): string {
    try {
      return app.getPath('userData')
    } catch {
      return path.resolve(process.cwd(), '.ygg-chat-r')
    }
  }

  getConfigPath(): string {
    return path.join(this.getConfigDirectory(), MCP_CONFIG_FILE)
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._doInitialize()
    await this.initPromise
    this.initPromise = null
  }

  private async _doInitialize(): Promise<void> {
    this.configPath = this.getConfigPath()
    console.log('[McpManager] Initializing with config:', this.configPath)

    // Ensure config directory exists
    await fs.mkdir(path.dirname(this.configPath), { recursive: true })

    // Load and start servers
    const configs = await this.loadConfig()

    for (const config of configs) {
      if (config.enabled && config.autoStart !== false) {
        try {
          await this.startServer(config)
        } catch (err) {
          console.error(`[McpManager] Failed to start ${config.name}:`, err)
        }
      }
    }

    this.initialized = true
    console.log(`[McpManager] Initialized with ${this.clients.size} connected servers`)
  }

  private async loadConfig(): Promise<McpServerConfig[]> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8')
      const config: McpConfigFile = JSON.parse(content)

      return Object.entries(config.servers).map(([name, serverConfig]) => ({
        name,
        enabled: serverConfig.enabled !== false,
        autoStart: serverConfig.autoStart,
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      }))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Create default config
        await this.saveConfig([])
        return []
      }
      console.error('[McpManager] Failed to load config:', err)
      return []
    }
  }

  private async saveConfig(configs: McpServerConfig[]): Promise<void> {
    const configFile: McpConfigFile = {
      servers: {},
    }

    for (const config of configs) {
      configFile.servers[config.name] = {
        command: config.command,
        args: config.args,
        env: config.env,
        enabled: config.enabled,
        autoStart: config.autoStart,
      }
    }

    await fs.writeFile(this.configPath, JSON.stringify(configFile, null, 2), 'utf-8')
  }

  async startServer(config: McpServerConfig): Promise<void> {
    // Check if already running
    const existing = this.clients.get(config.name)
    if (existing && existing.status === 'connected') {
      console.log(`[McpManager] Server ${config.name} already connected`)
      return
    }

    // Create and connect client
    const client = new McpClient(config.name, config)

    client.on('statusChange', (status) => {
      this.emit('serverStatusChange', { name: config.name, status })
    })

    this.clients.set(config.name, client)
    await client.connect()
  }

  async stopServer(name: string): Promise<void> {
    const client = this.clients.get(name)
    if (client) {
      await client.disconnect()
      this.clients.delete(name)
    }
  }

  async restartServer(name: string): Promise<void> {
    const client = this.clients.get(name)
    if (client) {
      await client.disconnect()
      await client.connect()
    }
  }

  async addServer(config: McpServerConfig): Promise<void> {
    // Load current configs
    const configs = await this.loadConfig()

    // Check for duplicate
    if (configs.some(c => c.name === config.name)) {
      throw new Error(`Server '${config.name}' already exists`)
    }

    configs.push(config)
    await this.saveConfig(configs)

    // Start if enabled
    if (config.enabled && config.autoStart !== false) {
      await this.startServer(config)
    }
  }

  async updateServer(name: string, updates: Partial<McpServerConfig>): Promise<void> {
    const configs = await this.loadConfig()
    const index = configs.findIndex(c => c.name === name)

    if (index === -1) {
      throw new Error(`Server '${name}' not found`)
    }

    configs[index] = { ...configs[index], ...updates }
    await this.saveConfig(configs)

    // Restart if running
    const client = this.clients.get(name)
    if (client && client.status === 'connected') {
      await this.restartServer(name)
    }
  }

  async removeServer(name: string): Promise<void> {
    // Stop if running
    await this.stopServer(name)

    // Remove from config
    const configs = await this.loadConfig()
    const filtered = configs.filter(c => c.name !== name)
    await this.saveConfig(filtered)
  }

  // ============================================================================
  // Tool operations
  // ============================================================================

  getAllTools(): McpToolDefinition[] {
    const tools: McpToolDefinition[] = []
    for (const client of this.clients.values()) {
      if (client.status === 'connected') {
        tools.push(...client.tools)
      }
    }
    return tools
  }

  async callTool(qualifiedName: string, args: any): Promise<McpToolCallResult> {
    // Parse qualified name: mcp__serverName__toolName
    const match = qualifiedName.match(/^mcp__([^_]+)__(.+)$/)
    if (!match) {
      throw new Error(`Invalid MCP tool name: ${qualifiedName}. Expected format: mcp__serverName__toolName`)
    }

    const [, serverName, toolName] = match
    const client = this.clients.get(serverName)

    if (!client) {
      throw new Error(`MCP server '${serverName}' not found`)
    }

    if (client.status !== 'connected') {
      throw new Error(`MCP server '${serverName}' is not connected (status: ${client.status})`)
    }

    return await client.callTool(toolName, args)
  }

  // Check if a tool name is an MCP tool
  isMcpTool(name: string): boolean {
    return name.startsWith('mcp__')
  }

  // ============================================================================
  // Resource operations
  // ============================================================================

  getAllResources(): McpResourceDefinition[] {
    const resources: McpResourceDefinition[] = []
    for (const client of this.clients.values()) {
      if (client.status === 'connected') {
        resources.push(...client.resources)
      }
    }
    return resources
  }

  async readResource(serverName: string, uri: string): Promise<any> {
    const client = this.clients.get(serverName)
    if (!client || client.status !== 'connected') {
      throw new Error(`MCP server '${serverName}' is not connected`)
    }
    return await client.readResource(uri)
  }

  // ============================================================================
  // Prompt operations
  // ============================================================================

  getAllPrompts(): McpPromptDefinition[] {
    const prompts: McpPromptDefinition[] = []
    for (const client of this.clients.values()) {
      if (client.status === 'connected') {
        prompts.push(...client.prompts)
      }
    }
    return prompts
  }

  async getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<any> {
    const client = this.clients.get(serverName)
    if (!client || client.status !== 'connected') {
      throw new Error(`MCP server '${serverName}' is not connected`)
    }
    return await client.getPrompt(promptName, args)
  }

  // ============================================================================
  // Status
  // ============================================================================

  getStatus(): McpServerStatus[] {
    return Array.from(this.clients.values()).map(c => c.getStatus())
  }

  getServerStatus(name: string): McpServerStatus | undefined {
    return this.clients.get(name)?.getStatus()
  }

  async getConfigs(): Promise<McpServerConfig[]> {
    return await this.loadConfig()
  }

  // ============================================================================
  // Shutdown
  // ============================================================================

  async shutdown(): Promise<void> {
    console.log('[McpManager] Shutting down all MCP servers...')
    const promises = Array.from(this.clients.keys()).map(name => this.stopServer(name))
    await Promise.all(promises)
    console.log('[McpManager] All MCP servers stopped')
  }
}

// Singleton export
export const mcpManager = new McpManager()
