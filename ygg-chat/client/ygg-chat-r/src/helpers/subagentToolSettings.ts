// Subagent Tool Settings Storage
// Persists subagent tool configuration to localStorage

const STORAGE_KEY = 'ygg_subagent_tool_settings'

export interface SubagentToolSettings {
  enabledTools: string[] // Tool names enabled for subagent when orchestratorMode=false
  defaultMaxTurns: number // Default max turns if not specified
  orchestratorEnabled: boolean // Whether subagent can use tools (orchestrator mode)
}

// Default configuration for non-orchestrator mode
export const DEFAULT_SUBAGENT_TOOLS = [
  'read_file',
  'read_files',
  'glob',
  'ripgrep',
  'browse_web',
  'brave_search',
]

export const DEFAULT_MAX_TURNS = 10

const DEFAULT_SETTINGS: SubagentToolSettings = {
  enabledTools: DEFAULT_SUBAGENT_TOOLS,
  defaultMaxTurns: DEFAULT_MAX_TURNS,
  orchestratorEnabled: true, // Subagent can use tools by default
}

/**
 * Load subagent tool settings from localStorage
 */
export function loadSubagentToolSettings(): SubagentToolSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(stored) as Partial<SubagentToolSettings>
    return {
      enabledTools: parsed.enabledTools ?? DEFAULT_SETTINGS.enabledTools,
      defaultMaxTurns: parsed.defaultMaxTurns ?? DEFAULT_SETTINGS.defaultMaxTurns,
      orchestratorEnabled: parsed.orchestratorEnabled ?? DEFAULT_SETTINGS.orchestratorEnabled,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Save subagent tool settings to localStorage
 */
export function saveSubagentToolSettings(settings: SubagentToolSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    console.error('[SubagentToolSettings] Failed to save settings:', error)
  }
}

/**
 * Get the list of enabled tools for subagent (non-orchestrator mode)
 */
export function getSubagentEnabledTools(): string[] {
  const settings = loadSubagentToolSettings()
  return settings.enabledTools
}

/**
 * Set the list of enabled tools for subagent
 */
export function setSubagentEnabledTools(tools: string[]): void {
  const settings = loadSubagentToolSettings()
  settings.enabledTools = tools
  saveSubagentToolSettings(settings)
}

/**
 * Get the default max turns setting
 */
export function getDefaultMaxTurns(): number {
  const settings = loadSubagentToolSettings()
  return settings.defaultMaxTurns
}

/**
 * Set the default max turns setting
 */
export function setDefaultMaxTurns(maxTurns: number): void {
  const settings = loadSubagentToolSettings()
  settings.defaultMaxTurns = Math.max(1, Math.min(50, maxTurns))
  saveSubagentToolSettings(settings)
}

/**
 * Check if orchestrator mode is enabled for subagents
 */
export function isOrchestratorEnabled(): boolean {
  const settings = loadSubagentToolSettings()
  return settings.orchestratorEnabled
}

/**
 * Set orchestrator mode enabled/disabled
 */
export function setOrchestratorEnabled(enabled: boolean): void {
  const settings = loadSubagentToolSettings()
  settings.orchestratorEnabled = enabled
  saveSubagentToolSettings(settings)
}

/**
 * Toggle orchestrator mode
 */
export function toggleOrchestratorEnabled(): boolean {
  const settings = loadSubagentToolSettings()
  settings.orchestratorEnabled = !settings.orchestratorEnabled
  saveSubagentToolSettings(settings)
  return settings.orchestratorEnabled
}
