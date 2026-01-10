// electron/tools/customToolManager.ts
// Built-in tool for managing and querying custom tools
// Reduces context by allowing AI to discover tools on-demand instead of receiving all definitions upfront

import { customToolRegistry, CustomToolDefinition } from './customToolLoader'

interface CustomToolManagerArgs {
  action: 'list' | 'get'
  names?: string[] // For 'get' action - tool names to retrieve full definitions
}

interface ToolSummary {
  name: string
  description: string // Brief one-line description
  enabled: boolean
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
  const { action, names } = args

  // Ensure registry is initialized
  await customToolRegistry.initialize()

  if (action === 'list') {
    const definitions = customToolRegistry.getDefinitions()

    const tools: ToolSummary[] = definitions.map(def => ({
      name: def.name,
      description: getBriefDescription(def.description),
      enabled: def.enabled,
    }))

    // Sort alphabetically by name
    tools.sort((a, b) => a.name.localeCompare(b.name))

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

  return {
    success: false,
    error: `Unknown action: ${action}. Valid actions are "list" or "get".`,
  }
}
