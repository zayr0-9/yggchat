// electron/tools/customToolManager.ts
// Built-in tool for managing and querying custom tools
// Reduces context by allowing AI to discover tools on-demand instead of receiving all definitions upfront

import { customToolRegistry, CustomToolDefinition } from './customToolLoader'

interface CustomToolManagerArgs {
  action: 'list' | 'get' | 'enable' | 'disable' | 'add' | 'remove' | 'reload' | 'settings'
  names?: string[] // For 'get' action - tool names to retrieve full definitions
  name?: string // For enable/disable/remove
  sourcePath?: string // For add
  directoryName?: string // Optional destination directory for add
  overwrite?: boolean // For add
  autoRefresh?: boolean // For settings
  refreshDebounceMs?: number // For settings
}

interface ToolSummary {
  name: string
  description: string // Brief one-line description
  enabled: boolean
  loaded?: boolean
  directoryName?: string
}

interface CustomToolManagerResult {
  success: boolean
  error?: string
  // For 'list' action
  tools?: ToolSummary[]
  totalCount?: number
  // For 'get' action
  definitions?: CustomToolDefinition[]
  notFound?: string[]
  // For lifecycle actions
  tool?: CustomToolDefinition
  settings?: {
    autoRefresh: boolean
    refreshDebounceMs: number
  }
  added?: {
    targetPath: string
    loadedToolNames: string[]
  }
  removed?: {
    removedPath: string
    removedToolNames: string[]
  }
}

/**
 * Truncate description to first sentence or first 100 chars
 */
function getBriefDescription(description: string): string {
  // First try to get first sentence
  const sentenceMatch = description.match(/^[^.!?]+[.!?]/)
  if (sentenceMatch && sentenceMatch[0].length <= 120) {
    return sentenceMatch[0].trim()
  }

  // Otherwise truncate at 100 chars
  if (description.length <= 100) {
    return description
  }

  return description.slice(0, 97) + '...'
}

/**
 * Execute the custom_tool_manager tool
 */
export async function execute(args: CustomToolManagerArgs): Promise<CustomToolManagerResult> {
  const { action, names, name } = args

  // Ensure registry is initialized
  await customToolRegistry.initialize()

  if (action === 'list') {
    const statuses = customToolRegistry.getStatuses()

    const tools: ToolSummary[] = statuses.map(status => ({
      name: status.name,
      description: getBriefDescription(status.description),
      enabled: status.enabled,
      loaded: status.loaded,
      directoryName: status.directoryName,
    }))

    return {
      success: true,
      tools,
      totalCount: tools.length,
    }
  }

  if (action === 'get') {
    if (!names || !Array.isArray(names) || names.length === 0) {
      return {
        success: false,
        error: 'The "get" action requires a "names" array with at least one tool name',
      }
    }

    const allDefinitions = customToolRegistry.getDefinitions()
    const definitionMap = new Map(allDefinitions.map(d => [d.name, d]))

    const found: CustomToolDefinition[] = []
    const notFound: string[] = []

    for (const name of names) {
      const def = definitionMap.get(name)
      if (def) {
        found.push(def)
      } else {
        notFound.push(name)
      }
    }

    return {
      success: true,
      definitions: found,
      notFound: notFound.length > 0 ? notFound : undefined,
    }
  }

  if (action === 'enable' || action === 'disable') {
    if (!name || typeof name !== 'string') {
      return { success: false, error: `The "${action}" action requires a "name"` }
    }

    const definition = await customToolRegistry.setToolEnabled(name, action === 'enable')
    if (!definition) {
      return { success: false, error: `Custom tool "${name}" not found` }
    }

    return {
      success: true,
      tool: definition,
    }
  }

  if (action === 'add') {
    if (!args.sourcePath || typeof args.sourcePath !== 'string') {
      return { success: false, error: 'The "add" action requires a "sourcePath" directory path' }
    }

    try {
      const result = await customToolRegistry.addToolFromDirectory(args.sourcePath, {
        directoryName: args.directoryName,
        overwrite: args.overwrite,
      })
      return {
        success: true,
        added: result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (action === 'remove') {
    if (!name || typeof name !== 'string') {
      return { success: false, error: 'The "remove" action requires a "name"' }
    }

    try {
      const result = await customToolRegistry.removeTool(name)
      return {
        success: true,
        removed: result,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (action === 'reload') {
    await customToolRegistry.reload('manager_reload')
    const tools = customToolRegistry.getStatuses().map(status => ({
      name: status.name,
      description: getBriefDescription(status.description),
      enabled: status.enabled,
      loaded: status.loaded,
      directoryName: status.directoryName,
    }))
    return {
      success: true,
      tools,
      totalCount: tools.length,
    }
  }

  if (action === 'settings') {
    const hasUpdate = args.autoRefresh !== undefined || args.refreshDebounceMs !== undefined
    const settings = hasUpdate
      ? await customToolRegistry.updateSettings({
          autoRefresh: args.autoRefresh,
          refreshDebounceMs: args.refreshDebounceMs,
        })
      : customToolRegistry.getSettings()

    return {
      success: true,
      settings,
    }
  }

  return {
    success: false,
    error:
      'Unknown action. Valid actions: "list", "get", "enable", "disable", "add", "remove", "reload", "settings".',
  }
}
