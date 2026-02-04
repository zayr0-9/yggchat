// electron/tools/customToolLoader.ts
// Dynamic loader for user-defined custom tools from userData/custom-tools/

import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'

const CUSTOM_TOOLS_DIR_NAME = 'custom-tools'
const CUSTOM_TOOLS_GUIDE_FILE = 'CUSTOM_TOOLS_GUIIDE.md'
const DEFINITION_FILE = 'definition.json'
const IMPLEMENTATION_FILE = 'index.js'
const EXECUTION_TIMEOUT_MS = 60000 // 60 seconds

// Cached base directory
let cachedBaseDir: string | null = null

function resolveBaseDir(): string {
  if (cachedBaseDir) {
    return cachedBaseDir
  }

  // Check environment variable override first
  const envOverride = process.env.YGG_CUSTOM_TOOLS_DIRECTORY?.trim()
  if (envOverride) {
    cachedBaseDir = path.resolve(envOverride)
    return cachedBaseDir
  }

  // Use Electron's userData path, with fallback for non-Electron environments
  try {
    cachedBaseDir = app.getPath('userData')
  } catch {
    cachedBaseDir = path.resolve(process.cwd(), '.ygg-chat-r', 'custom-tools-storage')
  }

  return cachedBaseDir
}

function getCustomToolsDirectory(): string {
  return path.join(resolveBaseDir(), CUSTOM_TOOLS_DIR_NAME)
}

function resolveGuideSourcePath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, CUSTOM_TOOLS_DIR_NAME, CUSTOM_TOOLS_GUIDE_FILE)
  }

  try {
    return path.join(app.getAppPath(), CUSTOM_TOOLS_DIR_NAME, CUSTOM_TOOLS_GUIDE_FILE)
  } catch {
    return path.join(process.cwd(), CUSTOM_TOOLS_DIR_NAME, CUSTOM_TOOLS_GUIDE_FILE)
  }
}

// Tool definition interface (matches toolDefinitions.ts pattern)
export interface CustomToolDefinition {
  name: string
  version?: string
  enabled: boolean
  description: string
  appPermissions?: {
    agent?: 'read' | 'write'
  }
  jsRuntimeMode?: 'electron' | 'custom' | 'none'
  jsRuntimes?: string
  author?: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  isCustom: true // Flag to distinguish from built-in
  sourcePath: string
}

// Tool execution options (matches built-in tools pattern, extended with context)
export interface ToolExecutionOptions {
  cwd?: string
  operationMode?: 'plan' | 'execute'
  rootPath?: string
  conversationId?: string | null
  messageId?: string | null
  streamId?: string | null
}

// Tool result interface
export interface ToolResult {
  success: boolean
  error?: string
  [key: string]: any
}

// Tool implementation interface
export interface CustomToolImplementation {
  execute: (args: any, options: ToolExecutionOptions) => Promise<ToolResult>
  meta?: { name: string; version: string }
}

interface LoadedCustomTool {
  definition: CustomToolDefinition
  implementation: CustomToolImplementation
}

// Validate tool name format (lowercase alphanumeric with underscores)
function isValidToolName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name)
}

// Validate definition structure
function validateDefinition(def: any): def is Omit<CustomToolDefinition, 'isCustom' | 'sourcePath'> {
  if (typeof def !== 'object' || def === null) return false
  if (typeof def.name !== 'string' || !isValidToolName(def.name)) return false
  if (typeof def.description !== 'string' || def.description.length === 0) return false
  if (typeof def.inputSchema !== 'object' || def.inputSchema === null) return false
  if (def.inputSchema.type !== 'object') return false
  if (typeof def.inputSchema.properties !== 'object') return false
  // enabled defaults to true if not specified
  if (def.enabled !== undefined && typeof def.enabled !== 'boolean') return false
  return true
}

type JsRuntimeMode = 'electron' | 'custom' | 'none'

function resolveRuntimeEnv(definition: CustomToolDefinition): {
  jsRuntimes?: string
  setElectronRunAsNode: boolean
} | null {
  const mode: JsRuntimeMode = definition.jsRuntimeMode || 'electron'

  if (mode === 'none') return null
  if (mode === 'custom') {
    const jsRuntimes = definition.jsRuntimes?.trim()
    if (!jsRuntimes) return null
    return { jsRuntimes, setElectronRunAsNode: false }
  }

  return { jsRuntimes: `node:${process.execPath}`, setElectronRunAsNode: true }
}

function snapshotEnv(key: string): { hasKey: boolean; value?: string } {
  const hasKey = Object.prototype.hasOwnProperty.call(process.env, key)
  return { hasKey, value: hasKey ? process.env[key] : undefined }
}

function restoreEnv(key: string, snapshot: { hasKey: boolean; value?: string }): void {
  if (snapshot.hasKey && snapshot.value !== undefined) {
    process.env[key] = snapshot.value
    return
  }

  delete process.env[key]
}

/**
 * Custom Tool Registry
 * Manages loading, storing, and executing user-defined custom tools
 */
class CustomToolRegistry {
  private tools: Map<string, LoadedCustomTool> = new Map()
  private initialized: boolean = false
  private initPromise: Promise<void> | null = null

  /**
   * Initialize the registry by scanning the custom tools directory
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._doInitialize()
    await this.initPromise
    this.initPromise = null
  }

  private async _doInitialize(): Promise<void> {
    const customToolsDir = getCustomToolsDirectory()
    console.log('[CustomToolLoader] Initializing custom tools from:', customToolsDir)

    await this.ensureDirectory()
    await this.ensureGuideFile()
    await this.loadAllTools()
    this.initialized = true
  }

  private async ensureDirectory(): Promise<void> {
    const dir = getCustomToolsDirectory()
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch (error) {
      console.error('[CustomToolLoader] Failed to create directory:', error)
    }
  }

  private async ensureGuideFile(): Promise<void> {
    const targetPath = path.join(getCustomToolsDirectory(), CUSTOM_TOOLS_GUIDE_FILE)

    try {
      await fs.access(targetPath)
      return
    } catch {
      // File does not exist; seed it below.
    }

    const sourcePath = resolveGuideSourcePath()
    try {
      await fs.access(sourcePath)
    } catch (error) {
      console.warn('[CustomToolLoader] Guide file not found at:', sourcePath, error)
      return
    }

    try {
      await fs.copyFile(sourcePath, targetPath)
      console.log('[CustomToolLoader] Seeded custom tools guide at:', targetPath)
    } catch (error) {
      console.error('[CustomToolLoader] Failed to seed guide file:', error)
    }
  }

  /**
   * Load all tools from the custom tools directory
   */
  private async loadAllTools(): Promise<void> {
    this.tools.clear()
    const dir = getCustomToolsDirectory()

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          await this.loadTool(entry.name)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[CustomToolLoader] Error scanning tools directory:', error)
      }
    }
  }

  /**
   * Load a single tool from its directory
   */
  private async loadTool(toolDirName: string): Promise<void> {
    const toolPath = path.join(getCustomToolsDirectory(), toolDirName)
    const definitionPath = path.join(toolPath, DEFINITION_FILE)
    const implementationPath = path.join(toolPath, IMPLEMENTATION_FILE)

    try {
      // Check both files exist
      await fs.access(definitionPath)
      await fs.access(implementationPath)

      // Load and parse definition
      const definitionRaw = await fs.readFile(definitionPath, 'utf-8')
      let definition: any
      try {
        definition = JSON.parse(definitionRaw)
      } catch (parseError) {
        console.warn(`[CustomToolLoader] Invalid JSON in ${toolDirName}/definition.json:`, parseError)
        return
      }

      // Validate definition schema
      if (!validateDefinition(definition)) {
        console.warn(
          `[CustomToolLoader] Invalid definition for ${toolDirName}: ` +
            'Must have name (lowercase with underscores), description, and inputSchema with type "object"'
        )
        return
      }

      // Check for name collision with directory name
      if (definition.name !== toolDirName && definition.name !== toolDirName.replace(/-/g, '_')) {
        console.warn(
          `[CustomToolLoader] Tool name "${definition.name}" doesn't match directory "${toolDirName}". ` +
            'Consider renaming for consistency.'
        )
      }

      // Load implementation using dynamic import
      const implementationUrl = pathToFileURL(implementationPath).href
      let implementation: any
      try {
        implementation = await import(implementationUrl)
      } catch (importError) {
        console.warn(`[CustomToolLoader] Failed to import ${toolDirName}/index.js:`, importError)
        return
      }

      // Validate implementation has execute function
      if (typeof implementation.execute !== 'function') {
        console.warn(`[CustomToolLoader] Missing or invalid 'execute' function in ${toolDirName}/index.js`)
        return
      }

      // Build custom definition with metadata
      const customDefinition: CustomToolDefinition = {
        name: definition.name,
        version: definition.version,
        enabled: definition.enabled !== false, // Default to true
        description: definition.description,
        appPermissions: definition.appPermissions,
        jsRuntimeMode: definition.jsRuntimeMode,
        jsRuntimes: definition.jsRuntimes,
        author: definition.author,
        inputSchema: definition.inputSchema,
        isCustom: true,
        sourcePath: toolPath,
      }

      // Register the tool
      this.tools.set(definition.name, {
        definition: customDefinition,
        implementation: implementation as CustomToolImplementation,
      })

      console.log(`[CustomToolLoader] Loaded custom tool: ${definition.name}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(
          `[CustomToolLoader] Tool ${toolDirName} missing required files (${DEFINITION_FILE} and/or ${IMPLEMENTATION_FILE})`
        )
      } else {
        console.warn(`[CustomToolLoader] Failed to load tool ${toolDirName}:`, error)
      }
    }
  }

  /**
   * Get all custom tool definitions
   */
  getDefinitions(): CustomToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition)
  }

  /**
   * Get a specific tool's implementation
   */
  getImplementation(name: string): CustomToolImplementation | undefined {
    return this.tools.get(name)?.implementation
  }

  /**
   * Check if a custom tool exists
   */
  hasCustomTool(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Execute a custom tool with timeout protection
   */
  async executeTool(name: string, args: any, options: ToolExecutionOptions): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { success: false, error: `Custom tool '${name}' not found` }
    }

    // Check if tool is enabled
    if (!tool.definition.enabled) {
      return { success: false, error: `Custom tool '${name}' is disabled` }
    }

    const envPatch = resolveRuntimeEnv(tool.definition)
    const prevJsRuntimes = snapshotEnv('YT_DLP_JS_RUNTIMES')
    const prevElectronRunAsNode = snapshotEnv('ELECTRON_RUN_AS_NODE')

    if (envPatch) {
      if (envPatch.jsRuntimes) {
        process.env.YT_DLP_JS_RUNTIMES = envPatch.jsRuntimes
      }
      if (envPatch.setElectronRunAsNode) {
        process.env.ELECTRON_RUN_AS_NODE = '1'
      }
    }

    try {
      // Execute with timeout
      const result = await Promise.race([
        tool.implementation.execute(args, options),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool execution timed out after ${EXECUTION_TIMEOUT_MS}ms`)),
            EXECUTION_TIMEOUT_MS
          )
        ),
      ])

      return result
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      restoreEnv('YT_DLP_JS_RUNTIMES', prevJsRuntimes)
      restoreEnv('ELECTRON_RUN_AS_NODE', prevElectronRunAsNode)
    }
  }

  /**
   * Reload all custom tools from disk
   */
  async reload(): Promise<void> {
    console.log('[CustomToolLoader] Reloading custom tools...')
    this.initialized = false
    await this.initialize()
  }

  /**
   * Get the custom tools directory path
   */
  getCustomToolsDirectoryPath(): string {
    return getCustomToolsDirectory()
  }

  /**
   * Get count of loaded tools
   */
  getToolCount(): number {
    return this.tools.size
  }
}

// Singleton instance
export const customToolRegistry = new CustomToolRegistry()
