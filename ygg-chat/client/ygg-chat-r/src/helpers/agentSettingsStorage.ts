import { environment, localApi } from '../utils/api'

export const AGENT_SETTINGS_CHANGE_EVENT = 'ygg-agent-settings-change'

export interface AgentSettings {
  heartbeatTime: string | null
  agentName: string | null
  model: string | null
  modelContextLength: number | null
  loopIntervalMs: number | null
  autoResume: boolean
  toolAllowlist: string[] | null
}

const DEFAULT_SETTINGS: AgentSettings = {
  heartbeatTime: null,
  agentName: 'Global Agent',
  model: null,
  modelContextLength: null,
  loopIntervalMs: 60000,
  autoResume: true,
  toolAllowlist: null,
}

export async function loadAgentSettings(): Promise<AgentSettings> {
  if (environment !== 'electron') {
    return { ...DEFAULT_SETTINGS }
  }

  try {
    const response = await localApi.get<{
      heartbeatTime?: string | null
      agentName?: string | null
      model?: string | null
      modelContextLength?: number | null
      loopIntervalMs?: number | null
      autoResume?: number | boolean | null
      toolAllowlist?: string[] | null
      settings?: {
        heartbeat_time?: string | null
        agent_name?: string | null
        model?: string | null
        model_context_length?: number | null
        loop_interval_ms?: number | null
        auto_resume?: number | null
        tool_allowlist?: string | null
      }
    }>('/agent-settings')

    const heartbeatTime = response?.heartbeatTime ?? response?.settings?.heartbeat_time ?? null
    const agentName = response?.agentName ?? response?.settings?.agent_name ?? DEFAULT_SETTINGS.agentName
    const model = response?.model ?? response?.settings?.model ?? DEFAULT_SETTINGS.model
    const modelContextLength =
      response?.modelContextLength ?? response?.settings?.model_context_length ?? DEFAULT_SETTINGS.modelContextLength
    const loopIntervalMs = response?.loopIntervalMs ?? response?.settings?.loop_interval_ms ?? DEFAULT_SETTINGS.loopIntervalMs
    const autoResumeRaw = response?.autoResume ?? response?.settings?.auto_resume
    const autoResume = autoResumeRaw === null || autoResumeRaw === undefined ? DEFAULT_SETTINGS.autoResume : !!autoResumeRaw
    const toolAllowlist =
      response?.toolAllowlist ??
      (response?.settings?.tool_allowlist ? JSON.parse(response.settings.tool_allowlist) : DEFAULT_SETTINGS.toolAllowlist)

    return { heartbeatTime, agentName, model, modelContextLength, loopIntervalMs, autoResume, toolAllowlist }
  } catch (error) {
    console.error('Failed to load agent settings:', error)
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveAgentSettings(settings: AgentSettings): Promise<AgentSettings> {
  if (environment !== 'electron') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AGENT_SETTINGS_CHANGE_EVENT, { detail: settings }))
    }
    return settings
  }

  const response = await localApi.put<{
    settings?: {
      heartbeat_time?: string | null
      agent_name?: string | null
      model?: string | null
      model_context_length?: number | null
      loop_interval_ms?: number | null
      auto_resume?: number | null
      tool_allowlist?: string | null
    }
  }>(
    '/agent-settings',
    {
      heartbeatTime: settings.heartbeatTime ?? null,
      agentName: settings.agentName ?? null,
      model: settings.model ?? null,
      modelContextLength: settings.modelContextLength ?? null,
      loopIntervalMs: settings.loopIntervalMs ?? null,
      autoResume: settings.autoResume ?? null,
      toolAllowlist: settings.toolAllowlist ?? null,
    }
  )

  const normalized: AgentSettings = {
    heartbeatTime: response?.settings?.heartbeat_time ?? settings.heartbeatTime ?? null,
    agentName: response?.settings?.agent_name ?? settings.agentName ?? DEFAULT_SETTINGS.agentName,
    model: response?.settings?.model ?? settings.model ?? DEFAULT_SETTINGS.model,
    modelContextLength:
      response?.settings?.model_context_length ?? settings.modelContextLength ?? DEFAULT_SETTINGS.modelContextLength,
    loopIntervalMs: response?.settings?.loop_interval_ms ?? settings.loopIntervalMs ?? DEFAULT_SETTINGS.loopIntervalMs,
    autoResume:
      response?.settings?.auto_resume === null || response?.settings?.auto_resume === undefined
        ? settings.autoResume ?? DEFAULT_SETTINGS.autoResume
        : !!response.settings.auto_resume,
    toolAllowlist: (() => {
      if (response?.settings?.tool_allowlist) {
        try {
          return JSON.parse(response.settings.tool_allowlist)
        } catch {
          return settings.toolAllowlist ?? DEFAULT_SETTINGS.toolAllowlist
        }
      }
      return settings.toolAllowlist ?? DEFAULT_SETTINGS.toolAllowlist
    })(),
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AGENT_SETTINGS_CHANGE_EVENT, { detail: normalized }))
  }

  return normalized
}
