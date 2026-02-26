// electron/mcp/mcpManager.ts
// MCP (Model Context Protocol) server manager
// Manages connections to MCP servers that provide tools, resources, and prompts

import { app, shell } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { EventEmitter } from 'events'
import { createServer, type Server as HttpServer } from 'http'
import { randomBytes, createHash } from 'crypto'
import {
  buildAuthorizationServerMetadataCandidates,
  buildProtectedResourceMetadataCandidates,
  parseWwwAuthenticateBearerChallenge,
} from './oauthDiscovery.js'

// ============================================================================
// Types and Interfaces
// ============================================================================

export type McpServerTransport = 'stdio' | 'http'

export interface McpOAuthConfig {
  resourceMetadataUrl?: string
  resource?: string
  authorizationServer?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  registrationEndpoint?: string
  scopes?: string[]
  clientId?: string
  clientSecret?: string
  tokenEndpointAuthMethod?: 'client_secret_post' | 'none'
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

export interface McpServerConfig {
  name: string
  enabled: boolean
  autoStart?: boolean // Start when app launches (default: true)

  // Transport selection
  transport?: McpServerTransport
  type?: McpServerTransport // Backward compatibility with .mcp.json-style configs

  // stdio transport
  command?: string
  args?: string[]
  env?: Record<string, string>

  // remote HTTP transport
  url?: string
  headers?: Record<string, string>

  // OAuth state for remote transport
  oauth?: McpOAuthConfig
}

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema: {
    type: 'object'
    properties?: Record<string, any>
    required?: string[]
  }
  _meta?: {
    ui?: {
      resourceUri?: string
      visibility?: Array<'model' | 'app'>
    }
    'ui/resourceUri'?: string
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

interface OAuthProtectedResourceMetadata {
  resource?: string
  authorization_servers?: string[]
  scopes_supported?: string[]
}

interface OAuthAuthorizationServerMetadata {
  issuer?: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  code_challenge_methods_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  client_id_metadata_document_supported?: boolean
}

interface OAuthTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
}

function normalizeTransport(value: unknown): McpServerTransport | undefined {
  if (value === 'http') return 'http'
  if (value === 'stdio') return 'stdio'
  return undefined
}

function resolveTransport(config: Partial<McpServerConfig>): McpServerTransport {
  return normalizeTransport(config.transport) ?? normalizeTransport(config.type) ?? (config.url ? 'http' : 'stdio')
}

const MCP_PROTOCOL_VERSION = '2025-11-25'
const OAUTH_ACCESS_TOKEN_CLOCK_SKEW_MS = 60_000

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
  private sessionId?: string
  private readonly transport: McpServerTransport
  private oauth?: McpOAuthConfig
  private authFlowPromise: Promise<void> | null = null
  private lastOAuthError?: string

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
    this.transport = resolveTransport(config)
    this.oauth = config.oauth ? { ...config.oauth } : undefined
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return
    }

    this.status = 'connecting'
    this.error = undefined
    this.emit('statusChange', this.status)

    try {
      if (this.transport === 'http') {
        await this.connectHttp()
      } else {
        await this.connectStdio()
      }

      // Initialize the connection
      await this.initialize()

      // Fetch capabilities
      await this.refreshCapabilities()

      this.status = 'connected'
      this.emit('statusChange', this.status)
      console.log(`[MCP:${this.name}] Connected successfully (${this.transport})`)
    } catch (err) {
      this.status = 'error'
      this.error = err instanceof Error ? err.message : String(err)
      this.emit('statusChange', this.status)
      await this.disconnect()
      throw err
    }
  }

  private async connectStdio(): Promise<void> {
    if (!this.config.command) {
      throw new Error(`MCP stdio server '${this.name}' is missing command`)
    }

    const env = { ...process.env, ...this.config.env }
    const args = Array.isArray(this.config.args) ? this.config.args : []

    this.process = spawn(this.config.command, args, {
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
  }

  private async connectHttp(): Promise<void> {
    if (!this.config.url) {
      throw new Error(`MCP HTTP server '${this.name}' is missing url`)
    }

    this.sessionId = undefined
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
    this.sessionId = undefined
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
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        roots: { listChanged: true },
        sampling: {},
        extensions: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html;profile=mcp-app'],
          },
        },
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
    if (this.transport === 'http') {
      return this.sendHttpRequest(method, params)
    }

    return this.sendStdioRequest(method, params)
  }

  private sendStdioRequest(method: string, params?: any): Promise<any> {
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

  private async sendHttpRequest(method: string, params?: any, allowAuthRetry = true): Promise<any> {
    if (!this.config.url) {
      throw new Error(`MCP HTTP server '${this.name}' is missing url`)
    }

    const id = ++this.requestId
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      this.lastOAuthError = undefined
      const headers = this.buildHttpHeaders()

      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      const responseSessionId = response.headers.get('mcp-session-id')
      if (responseSessionId) {
        this.sessionId = responseSessionId
      }

      const payload = await response.text()

      if (response.status === 401 && allowAuthRetry) {
        const authenticated = await this.tryHandleHttpUnauthorized(response)
        if (authenticated) {
          return this.sendHttpRequest(method, params, false)
        }
      }

      if (!response.ok) {
        const wwwAuthenticate = response.headers.get('www-authenticate')
        const oauthHint =
          response.status === 401 && wwwAuthenticate
            ? ` | OAuth required. WWW-Authenticate: ${wwwAuthenticate}`
            : ''
        const oauthFailureHint =
          response.status === 401 && this.lastOAuthError ? ` | OAuth flow failed: ${this.lastOAuthError}` : ''

        throw new Error(
          `MCP HTTP request failed (${response.status} ${response.statusText})${payload ? `: ${payload.slice(0, 400)}` : ''}${oauthHint}${oauthFailureHint}`
        )
      }

      if (!payload.trim()) {
        return undefined
      }

      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('text/event-stream')) {
        return this.resolveJsonRpcFromSse(payload, id)
      }

      try {
        const parsed = JSON.parse(payload)
        return this.resolveJsonRpcPayload(parsed, id)
      } catch (parseError) {
        if (payload.includes('\ndata:')) {
          return this.resolveJsonRpcFromSse(payload, id)
        }
        throw new Error(
          `MCP HTTP response parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        )
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  private buildHttpHeaders(): Record<string, string> {

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
      ...(this.config.headers || {}),
    }

    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId
    }

    if (!headers.Authorization && this.oauth?.accessToken) {
      headers.Authorization = `Bearer ${this.oauth.accessToken}`
    }

    return headers
  }

  private async tryHandleHttpUnauthorized(response: Response): Promise<boolean> {
    if (this.transport !== 'http') return false

    // If caller explicitly configured a static Authorization header and we don't have OAuth state,
    // do not override with interactive auth.
    if (this.config.headers?.Authorization && !this.oauth?.refreshToken && !this.oauth?.accessToken) {
      this.lastOAuthError =
        'Static Authorization header is configured; skipping interactive OAuth because no OAuth token state is present.'
      return false
    }

    const wwwAuthenticate = response.headers.get('www-authenticate')
    const challenge = parseWwwAuthenticateBearerChallenge(wwwAuthenticate)

    try {
      await this.ensureOAuthAccessToken({
        resourceMetadataUrlHint: challenge.resourceMetadataUrl,
        challengeScope: challenge.scope,
      })
      const authenticated = Boolean(this.oauth?.accessToken)
      this.lastOAuthError = authenticated ? undefined : 'OAuth flow completed without obtaining an access token.'
      return authenticated
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.lastOAuthError = message
      console.error(`[MCP:${this.name}] OAuth flow failed:`, error)
      return false
    }
  }

  private async ensureOAuthAccessToken(input?: {
    resourceMetadataUrlHint?: string
    challengeScope?: string
  }): Promise<void> {
    if (!this.config.url) {
      throw new Error(`MCP HTTP server '${this.name}' is missing url`)
    }

    if (this.authFlowPromise) {
      return this.authFlowPromise
    }

    this.authFlowPromise = (async () => {
      this.oauth = this.oauth || this.config.oauth || {}

      const now = Date.now()
      if (this.oauth.accessToken && (!this.oauth.expiresAt || this.oauth.expiresAt > now + OAUTH_ACCESS_TOKEN_CLOCK_SKEW_MS)) {
        this.applyAccessToken(this.oauth.accessToken)
        return
      }

      if (this.canRefreshOAuthToken()) {
        try {
          await this.refreshOAuthToken()
          return
        } catch (error) {
          console.warn(`[MCP:${this.name}] Refresh token failed, falling back to browser auth:`, error)
        }
      }

      await this.runInteractiveOAuthFlow(input)
    })()

    try {
      await this.authFlowPromise
    } finally {
      this.authFlowPromise = null
    }
  }

  private canRefreshOAuthToken(): boolean {
    if (!this.oauth?.refreshToken || !this.oauth?.tokenEndpoint || !this.oauth?.clientId) {
      return false
    }

    const authMethod = this.oauth.tokenEndpointAuthMethod || (this.oauth.clientSecret ? 'client_secret_post' : 'none')
    if (authMethod === 'none') {
      return true
    }

    return Boolean(this.oauth.clientSecret)
  }

  private async runInteractiveOAuthFlow(input?: {
    resourceMetadataUrlHint?: string
    challengeScope?: string
  }): Promise<void> {
    if (!this.config.url) {
      throw new Error(`MCP HTTP server '${this.name}' is missing url`)
    }

    const state = randomBytes(24).toString('hex')
    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')

    const callbackServer = await this.createOAuthCallbackServer(state)

    try {
      const oauthMeta = await this.discoverOAuthMetadata(input)
      const client = await this.resolveOAuthClientCredentials(oauthMeta, callbackServer.redirectUri)

      const authUrl = new URL(oauthMeta.authorizationEndpoint)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', client.clientId)
      authUrl.searchParams.set('redirect_uri', callbackServer.redirectUri)
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('resource', oauthMeta.resource)
      if (oauthMeta.scope) {
        authUrl.searchParams.set('scope', oauthMeta.scope)
      }

      await shell.openExternal(authUrl.toString())

      const authCode = await callbackServer.waitForCode(5 * 60_000)

      const token = await this.exchangeAuthorizationCodeForToken({
        code: authCode,
        codeVerifier,
        redirectUri: callbackServer.redirectUri,
        tokenEndpoint: oauthMeta.tokenEndpoint,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        resource: oauthMeta.resource,
      })

      this.oauth = {
        ...this.oauth,
        resourceMetadataUrl: oauthMeta.resourceMetadataUrl,
        resource: oauthMeta.resource,
        authorizationServer: oauthMeta.authorizationServer,
        authorizationEndpoint: oauthMeta.authorizationEndpoint,
        tokenEndpoint: oauthMeta.tokenEndpoint,
        registrationEndpoint: oauthMeta.registrationEndpoint,
        scopes: oauthMeta.scope ? oauthMeta.scope.split(' ').filter(Boolean) : this.oauth?.scopes,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
        accessToken: token.access_token,
        refreshToken: token.refresh_token || this.oauth?.refreshToken,
        expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      }

      this.config.oauth = { ...this.oauth }
      this.applyAccessToken(token.access_token)
      this.lastOAuthError = undefined
    } finally {
      await callbackServer.close().catch(() => undefined)
    }
  }

  private async discoverOAuthMetadata(input?: {
    resourceMetadataUrlHint?: string
    challengeScope?: string
  }): Promise<{
    resourceMetadataUrl: string
    resource: string
    authorizationServer: string
    authorizationEndpoint: string
    tokenEndpoint: string
    registrationEndpoint?: string
    scope?: string
    tokenEndpointAuthMethod: 'client_secret_post' | 'none'
  }> {
    if (!this.config.url) {
      throw new Error(`MCP HTTP server '${this.name}' is missing url`)
    }

    const mcpUrl = new URL(this.config.url)
    const resourceMetadataCandidates = [
      input?.resourceMetadataUrlHint,
      this.oauth?.resourceMetadataUrl,
      ...buildProtectedResourceMetadataCandidates(mcpUrl),
    ].filter((value): value is string => Boolean(value))

    const protectedResourceResult = await this.fetchFirstJson<OAuthProtectedResourceMetadata>(resourceMetadataCandidates)
    const protectedResource = protectedResourceResult.value

    const authorizationServer = this.oauth?.authorizationServer || protectedResource.authorization_servers?.[0]
    if (!authorizationServer) {
      throw new Error('OAuth discovery failed: authorization server not provided by protected resource metadata')
    }

    const authServerMetadataCandidates = buildAuthorizationServerMetadataCandidates(authorizationServer)
    const authServerMetadataResult = await this.fetchFirstJson<OAuthAuthorizationServerMetadata>(authServerMetadataCandidates)
    const authServerMetadata = authServerMetadataResult.value

    if (!authServerMetadata.authorization_endpoint || !authServerMetadata.token_endpoint) {
      throw new Error('OAuth discovery failed: authorization/token endpoints missing in auth server metadata')
    }

    const pkceMethods = authServerMetadata.code_challenge_methods_supported
    if (!Array.isArray(pkceMethods) || !pkceMethods.includes('S256')) {
      throw new Error('OAuth discovery failed: authorization server does not advertise PKCE S256 support')
    }

    const scope =
      input?.challengeScope ||
      this.oauth?.scopes?.join(' ') ||
      (Array.isArray(protectedResource.scopes_supported) && protectedResource.scopes_supported.length > 0
        ? protectedResource.scopes_supported.join(' ')
        : undefined)

    const tokenEndpointAuthMethod = this.selectTokenEndpointAuthMethod(
      this.oauth?.tokenEndpointAuthMethod,
      authServerMetadata.token_endpoint_auth_methods_supported
    )

    return {
      resourceMetadataUrl: protectedResourceResult.url,
      resource: protectedResource.resource || this.config.url,
      authorizationServer,
      authorizationEndpoint: authServerMetadata.authorization_endpoint,
      tokenEndpoint: authServerMetadata.token_endpoint,
      registrationEndpoint: authServerMetadata.registration_endpoint,
      scope,
      tokenEndpointAuthMethod,
    }
  }

  private selectTokenEndpointAuthMethod(
    configured: McpOAuthConfig['tokenEndpointAuthMethod'],
    supported: string[] | undefined
  ): 'client_secret_post' | 'none' {
    if (configured === 'client_secret_post' || configured === 'none') {
      return configured
    }

    if (Array.isArray(supported) && supported.length > 0) {
      if (supported.includes('client_secret_post')) return 'client_secret_post'
      if (supported.includes('none')) return 'none'
    }

    return this.oauth?.clientSecret ? 'client_secret_post' : 'none'
  }

  private async fetchFirstJson<T>(candidates: string[]): Promise<{ value: T; url: string }> {
    const errors: string[] = []

    for (const candidate of candidates) {
      try {
        const value = await this.fetchJson<T>(candidate)
        return { value, url: candidate }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${candidate} -> ${message}`)
      }
    }

    throw new Error(`OAuth discovery failed: unable to fetch metadata from candidates. ${errors.join(' | ')}`)
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
      },
    })

    const body = await response.text()
    if (!response.ok) {
      throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}${body ? ` - ${body.slice(0, 300)}` : ''}`)
    }

    try {
      return JSON.parse(body) as T
    } catch (error) {
      throw new Error(`Invalid JSON response from ${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async resolveOAuthClientCredentials(
    oauthMeta: {
      registrationEndpoint?: string
      tokenEndpointAuthMethod: 'client_secret_post' | 'none'
    },
    redirectUri: string
  ): Promise<{ clientId: string; clientSecret?: string; tokenEndpointAuthMethod: 'client_secret_post' | 'none' }> {
    if (this.oauth?.clientId) {
      if (oauthMeta.tokenEndpointAuthMethod === 'none') {
        return {
          clientId: this.oauth.clientId,
          clientSecret: this.oauth.clientSecret,
          tokenEndpointAuthMethod: 'none',
        }
      }

      if (this.oauth.clientSecret) {
        return {
          clientId: this.oauth.clientId,
          clientSecret: this.oauth.clientSecret,
          tokenEndpointAuthMethod: 'client_secret_post',
        }
      }
    }

    return this.registerDynamicClient(oauthMeta.registrationEndpoint, redirectUri, oauthMeta.tokenEndpointAuthMethod)
  }

  private async registerDynamicClient(
    registrationEndpoint: string | undefined,
    redirectUri: string,
    tokenEndpointAuthMethod: 'client_secret_post' | 'none'
  ): Promise<{ clientId: string; clientSecret?: string; tokenEndpointAuthMethod: 'client_secret_post' | 'none' }> {
    if (!registrationEndpoint) {
      throw new Error(
        'Authorization server does not expose dynamic client registration endpoint and no preregistered OAuth client credentials were supplied'
      )
    }

    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        client_name: `Ygg Chat MCP (${this.name})`,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: tokenEndpointAuthMethod,
      }),
    })

    const body = await response.text()
    if (!response.ok) {
      throw new Error(
        `Dynamic client registration failed (${response.status} ${response.statusText})${body ? `: ${body.slice(0, 400)}` : ''}`
      )
    }

    const payload = JSON.parse(body) as {
      client_id?: string
      client_secret?: string
      token_endpoint_auth_method?: 'client_secret_post' | 'none'
    }

    if (!payload.client_id) {
      throw new Error('Dynamic client registration response missing client_id')
    }

    const resolvedAuthMethod = payload.token_endpoint_auth_method || tokenEndpointAuthMethod
    if (resolvedAuthMethod === 'client_secret_post' && !payload.client_secret) {
      throw new Error('Dynamic client registration response missing client_secret for client_secret_post auth')
    }

    return {
      clientId: payload.client_id,
      clientSecret: payload.client_secret,
      tokenEndpointAuthMethod: resolvedAuthMethod,
    }
  }

  private async exchangeAuthorizationCodeForToken(input: {
    code: string
    codeVerifier: string
    redirectUri: string
    tokenEndpoint: string
    clientId: string
    clientSecret?: string
    tokenEndpointAuthMethod: 'client_secret_post' | 'none'
    resource: string
  }): Promise<OAuthTokenResponse> {
    const params = new URLSearchParams()
    params.set('grant_type', 'authorization_code')
    params.set('code', input.code)
    params.set('redirect_uri', input.redirectUri)
    params.set('code_verifier', input.codeVerifier)
    params.set('client_id', input.clientId)
    if (input.tokenEndpointAuthMethod === 'client_secret_post') {
      if (!input.clientSecret) {
        throw new Error('Token exchange requires client_secret for client_secret_post auth')
      }
      params.set('client_secret', input.clientSecret)
    }
    params.set('resource', input.resource)

    const response = await fetch(input.tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: params.toString(),
    })

    const body = await response.text()
    if (!response.ok) {
      throw new Error(
        `Token exchange failed (${response.status} ${response.statusText})${body ? `: ${body.slice(0, 400)}` : ''}`
      )
    }

    const token = JSON.parse(body) as OAuthTokenResponse
    if (!token.access_token) {
      throw new Error('Token exchange response missing access_token')
    }

    return token
  }

  private async refreshOAuthToken(): Promise<void> {
    if (!this.oauth?.refreshToken || !this.oauth?.tokenEndpoint || !this.oauth?.clientId) {
      throw new Error('Missing OAuth refresh token configuration')
    }

    const authMethod = this.oauth.tokenEndpointAuthMethod || (this.oauth.clientSecret ? 'client_secret_post' : 'none')

    const params = new URLSearchParams()
    params.set('grant_type', 'refresh_token')
    params.set('refresh_token', this.oauth.refreshToken)
    params.set('client_id', this.oauth.clientId)

    if (authMethod === 'client_secret_post') {
      if (!this.oauth.clientSecret) {
        throw new Error('Missing clientSecret for OAuth refresh token request using client_secret_post')
      }
      params.set('client_secret', this.oauth.clientSecret)
    }

    if (this.oauth.resource) {
      params.set('resource', this.oauth.resource)
    }

    const response = await fetch(this.oauth.tokenEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: params.toString(),
    })

    const body = await response.text()
    if (!response.ok) {
      throw new Error(
        `Refresh token request failed (${response.status} ${response.statusText})${body ? `: ${body.slice(0, 400)}` : ''}`
      )
    }

    const token = JSON.parse(body) as OAuthTokenResponse
    if (!token.access_token) {
      throw new Error('Refresh token response missing access_token')
    }

    this.oauth = {
      ...this.oauth,
      tokenEndpointAuthMethod: authMethod,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || this.oauth.refreshToken,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
    }

    this.config.oauth = { ...this.oauth }
    this.applyAccessToken(token.access_token)
    this.lastOAuthError = undefined
  }

  private applyAccessToken(accessToken: string): void {
    this.config.headers = {
      ...(this.config.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    }
  }

  private async createOAuthCallbackServer(expectedState: string): Promise<{
    redirectUri: string
    waitForCode: (timeoutMs?: number) => Promise<string>
    close: () => Promise<void>
  }> {
    const callbackPath = '/mcp/oauth/callback'
    let resolver: ((code: string) => void) | null = null
    let rejecter: ((err: Error) => void) | null = null

    const callbackPromise = new Promise<string>((resolve, reject) => {
      resolver = resolve
      rejecter = reject
    })

    const server: HttpServer = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || callbackPath, `http://${req.headers.host || '127.0.0.1'}`)
        if (requestUrl.pathname !== callbackPath) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('Not found')
          return
        }

        const state = requestUrl.searchParams.get('state')
        const code = requestUrl.searchParams.get('code')
        const error = requestUrl.searchParams.get('error')
        const errorDescription = requestUrl.searchParams.get('error_description')

        if (!state || state !== expectedState) {
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('Invalid OAuth state. You can close this tab and retry from the app.')
          rejecter?.(new Error('Invalid OAuth state received'))
          return
        }

        if (error) {
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(`OAuth authorization failed: ${errorDescription || error}. You can close this tab.`)
          rejecter?.(new Error(`OAuth authorization failed: ${errorDescription || error}`))
          return
        }

        if (!code) {
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('Missing authorization code. You can close this tab and retry from the app.')
          rejecter?.(new Error('OAuth callback missing authorization code'))
          return
        }

        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<html><body><h2>MCP authorization complete.</h2><p>You can close this tab and return to Ygg Chat.</p></body></html>')
        resolver?.(code)
      } catch (error) {
        rejecter?.(error instanceof Error ? error : new Error(String(error)))
      }
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        resolve()
      })
    })

    const address = server.address() as { port?: number } | null
    const port = address?.port
    if (!port) {
      server.close()
      throw new Error('Failed to start OAuth callback server')
    }

    return {
      redirectUri: `http://127.0.0.1:${port}${callbackPath}`,
      waitForCode: (timeoutMs = 5 * 60_000) =>
        new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Timed out waiting for OAuth callback'))
          }, timeoutMs)

          callbackPromise
            .then(code => {
              clearTimeout(timeout)
              resolve(code)
            })
            .catch(error => {
              clearTimeout(timeout)
              reject(error)
            })
        }),
      close: async () => {
        await new Promise<void>(resolve => {
          server.close(() => resolve())
        })
      },
    }
  }

  private resolveJsonRpcFromSse(payload: string, expectedId: number | string): any {

    const events = payload.split(/\r?\n\r?\n/)
    const parsedEvents: any[] = []

    for (const event of events) {
      const lines = event.split(/\r?\n/)
      const dataLines = lines
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .filter(Boolean)

      if (dataLines.length === 0) continue

      const data = dataLines.join('\n')
      if (data === '[DONE]') continue

      try {
        parsedEvents.push(JSON.parse(data))
      } catch {
        // Ignore non-JSON SSE event payloads
      }
    }

    if (parsedEvents.length === 0) {
      throw new Error('MCP HTTP SSE response did not contain JSON payloads')
    }

    return this.resolveJsonRpcPayload(parsedEvents, expectedId)
  }

  private resolveJsonRpcPayload(payload: any, expectedId: number | string): any {
    const messages = Array.isArray(payload) ? payload : [payload]
    let fallbackResult: any = undefined

    for (const message of messages) {
      if (!message || typeof message !== 'object') {
        continue
      }

      // Notification
      if ('method' in message && !('id' in message)) {
        this.handleNotification(message as JsonRpcNotification)
        continue
      }

      if ('id' in message) {
        if (message.id !== expectedId) {
          continue
        }

        if ('error' in message && message.error) {
          throw new Error(message.error.message || 'MCP request failed')
        }

        return message.result
      }

      if ('result' in message) {
        fallbackResult = message.result
      } else {
        fallbackResult = message
      }
    }

    if (fallbackResult !== undefined) {
      return fallbackResult
    }

    throw new Error('No matching JSON-RPC response found')
  }

  private sendNotification(method: string, params?: any): void {
    if (this.transport === 'http') {
      void this.sendHttpNotification(method, params)
      return
    }

    this.sendStdioNotification(method, params)
  }

  private sendStdioNotification(method: string, params?: any): void {
    if (!this.process?.stdin) return

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }

    const message = JSON.stringify(notification) + '\n'
    this.process.stdin.write(message)
  }

  private async sendHttpNotification(method: string, params?: any): Promise<void> {
    if (!this.config.url) return

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
      ...(this.config.headers || {}),
    }

    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId
    }

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(notification),
      })

      const responseSessionId = response.headers.get('mcp-session-id')
      if (responseSessionId) {
        this.sessionId = responseSessionId
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        console.warn(
          `[MCP:${this.name}] HTTP notification failed (${response.status} ${response.statusText})${body ? `: ${body.slice(0, 300)}` : ''}`
        )
      }
    } catch (error) {
      console.warn(`[MCP:${this.name}] HTTP notification error:`, error)
    }
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
  settings?: {
    lazyStart?: boolean
  }
  servers?: Record<string, Omit<McpServerConfig, 'name'>>
  mcpServers?: Record<string, Omit<McpServerConfig, 'name'>> // Compatibility with .mcp.json format
}

class McpManager extends EventEmitter {
  private clients: Map<string, McpClient> = new Map()
  private configPath: string = ''
  private initialized = false
  private initPromise: Promise<void> | null = null
  private settings: { lazyStart: boolean } = { lazyStart: true }

  getSettings(): { lazyStart: boolean } {
    return { ...this.settings }
  }

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

    if (!this.settings.lazyStart) {
      for (const config of configs) {
        if (config.enabled && config.autoStart !== false) {
          try {
            await this.startServer(config)
          } catch (err) {
            console.error(`[McpManager] Failed to start ${config.name}:`, err)
          }
        }
      }
    } else {
      console.log('[McpManager] Lazy start enabled: skipping auto-start')
    }

    this.initialized = true
    console.log(`[McpManager] Initialized with ${this.clients.size} connected servers`)
  }

  private async loadConfig(): Promise<McpServerConfig[]> {
    const config = await this.loadConfigFile()
    this.settings = { lazyStart: config.settings?.lazyStart ?? true }

    const rawServers = (config.servers && Object.keys(config.servers).length > 0
      ? config.servers
      : config.mcpServers) || {}

    return Object.entries(rawServers).map(([name, serverConfig]) => {
      const transport = resolveTransport(serverConfig)

      return {
        name,
        enabled: serverConfig.enabled !== false,
        autoStart: serverConfig.autoStart,
        transport,
        type: transport,
        command: serverConfig.command,
        args: Array.isArray(serverConfig.args) ? serverConfig.args : [],
        env: serverConfig.env,
        url: serverConfig.url,
        headers: serverConfig.headers,
        oauth: serverConfig.oauth,
      }
    })
  }

  private async loadConfigFile(): Promise<McpConfigFile> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8')
      const parsed: McpConfigFile = JSON.parse(content)
      const servers = parsed.servers || parsed.mcpServers || {}

      return {
        settings: parsed.settings,
        servers,
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const defaultConfig: McpConfigFile = {
          settings: { lazyStart: true },
          servers: {},
        }
        await fs.writeFile(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
        return defaultConfig
      }
      console.error('[McpManager] Failed to load config:', err)
      return { settings: { lazyStart: true }, servers: {} }
    }
  }

  private async saveConfig(configs: McpServerConfig[], settings?: { lazyStart?: boolean }): Promise<void> {
    const configFile: McpConfigFile = {
      settings: settings ?? this.settings,
      servers: {},
    }

    for (const config of configs) {
      const transport = resolveTransport(config)
      configFile.servers![config.name] = {
        enabled: config.enabled,
        autoStart: config.autoStart,
        transport,
        type: transport,
        command: config.command,
        args: config.args,
        env: config.env,
        url: config.url,
        headers: config.headers,
        oauth: config.oauth,
      }
    }

    await fs.writeFile(this.configPath, JSON.stringify(configFile, null, 2), 'utf-8')
  }

  private async persistClientConfig(name: string): Promise<void> {
    try {
      const client = this.clients.get(name)
      if (!client) return

      const configs = await this.loadConfig()
      const index = configs.findIndex(c => c.name === name)
      if (index === -1) return

      configs[index] = {
        ...configs[index],
        ...client.config,
        name: configs[index].name,
      }

      await this.saveConfig(configs, this.settings)
    } catch (error) {
      console.warn(`[McpManager] Failed to persist runtime config for ${name}:`, error)
    }
  }

  async updateSettings(updates: { lazyStart?: boolean }): Promise<{ lazyStart: boolean }> {
    const config = await this.loadConfigFile()
    const nextSettings = {
      lazyStart: updates.lazyStart ?? config.settings?.lazyStart ?? true,
    }
    config.settings = nextSettings
    await fs.writeFile(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
    this.settings = nextSettings
    return this.getSettings()
  }

  async startServer(config: McpServerConfig): Promise<void> {
    // Check if already running
    const existing = this.clients.get(config.name)
    if (existing && existing.status === 'connected') {
      console.log(`[McpManager] Server ${config.name} already connected`)
      return
    }

    const transport = resolveTransport(config)
    const normalizedConfig: McpServerConfig = {
      ...config,
      transport,
      type: transport,
      args: Array.isArray(config.args) ? config.args : [],
    }

    if (transport === 'http' && !normalizedConfig.url) {
      throw new Error(`MCP server '${config.name}' is configured for HTTP but missing url`)
    }

    if (transport === 'stdio' && !normalizedConfig.command) {
      throw new Error(`MCP server '${config.name}' is configured for stdio but missing command`)
    }

    // Create and connect client
    const client = new McpClient(config.name, normalizedConfig)

    client.on('statusChange', (status) => {
      this.emit('serverStatusChange', { name: config.name, status })
      if (status === 'connected') {
        void this.persistClientConfig(config.name)
      }
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

    const transport = resolveTransport(config)
    const normalizedConfig: McpServerConfig = {
      ...config,
      transport,
      type: transport,
      args: Array.isArray(config.args) ? config.args : [],
    }

    configs.push(normalizedConfig)
    await this.saveConfig(configs, this.settings)

    // Start if enabled
    if (!this.settings.lazyStart && normalizedConfig.enabled && normalizedConfig.autoStart !== false) {
      await this.startServer(normalizedConfig)
    }
  }

  async updateServer(name: string, updates: Partial<McpServerConfig>): Promise<void> {
    const configs = await this.loadConfig()
    const index = configs.findIndex(c => c.name === name)

    if (index === -1) {
      throw new Error(`Server '${name}' not found`)
    }

    const merged = { ...configs[index], ...updates }
    const transport = resolveTransport(merged)
    configs[index] = {
      ...merged,
      transport,
      type: transport,
      args: Array.isArray(merged.args) ? merged.args : [],
    }

    await this.saveConfig(configs, this.settings)

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
    await this.saveConfig(filtered, this.settings)
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

  private async ensureServerConnected(serverName: string): Promise<McpClient> {
    const existing = this.clients.get(serverName)
    if (existing && existing.status === 'connected') {
      return existing
    }

    const configs = await this.loadConfig()
    const config = configs.find(c => c.name === serverName)
    if (!config) {
      throw new Error(`MCP server '${serverName}' not found`)
    }
    if (!config.enabled) {
      throw new Error(`MCP server '${serverName}' is disabled`)
    }

    await this.startServer(config)
    const client = this.clients.get(serverName)
    if (!client || client.status !== 'connected') {
      throw new Error(`MCP server '${serverName}' failed to connect`)
    }
    return client
  }

  async callTool(qualifiedName: string, args: any): Promise<McpToolCallResult> {
    // Parse qualified name: mcp__serverName__toolName
    const match = qualifiedName.match(/^mcp__([^_]+)__(.+)$/)
    if (!match) {
      throw new Error(`Invalid MCP tool name: ${qualifiedName}. Expected format: mcp__serverName__toolName`)
    }

    const [, serverName, toolName] = match
    const client = await this.ensureServerConnected(serverName)
    return client.callTool(toolName, args)
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
    const client = await this.ensureServerConnected(serverName)
    return client.readResource(uri)
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
    const client = await this.ensureServerConnected(serverName)
    return client.getPrompt(promptName, args)
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
