import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk'

/**
 * Auto-approving permission handler for Claude Code tool usage
 * Automatically grants all permissions but logs them for transparency
 */

/**
 * Automatically approve a tool use request and log it
 *
 * @param toolName - Name of the tool being called
 * @param toolInput - Input parameters for the tool
 * @param options - SDK options including signal, suggestions, and toolUseID
 * @returns Permission decision object with behavior 'allow'
 */
export async function promptUserPermission(
  toolName: string,
  toolInput: Record<string, unknown>,
  options: {
    signal: AbortSignal
    suggestions?: any[]
    toolUseID: string
  }
): Promise<PermissionResult> {
  console.log('\n' + '='.repeat(70))
  console.log('🔐 PERMISSION REQUEST (AUTO-GRANTED)')
  console.log('='.repeat(70))
  console.log(`Tool: ${toolName}`)
  console.log(`Tool Use ID: ${options.toolUseID}`)
  console.log(`Input:`)
  console.log(JSON.stringify(toolInput, null, 2))
  console.log('✅ Permission automatically GRANTED')
  console.log('='.repeat(70) + '\n')

  return {
    behavior: 'allow',
    updatedInput: toolInput,
  }
}

/**
 * Create a permission handler callback that auto-approves all tool calls
 * This can be passed to startChat/resumeChat as the canUseTool parameter
 */
export function createInteractivePermissionHandler(): CanUseTool {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: {
      signal: AbortSignal
      suggestions?: any[]
      toolUseID: string
    }
  ) => {
    return promptUserPermission(toolName, input, options)
  }
}
