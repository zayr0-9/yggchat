import express from 'express'
import { verifyAuth } from '../middleware/supaAuth'
import { asyncHandler } from '../utils/asyncHandler'

type JsonRecord = Record<string, unknown>

type LedgerRow = {
  id: string
  delta_credits: number | string | null
  kind: string
  external_ref_type: string | null
  external_ref_id: string | null
  message_id: string | null
  conversation_id: string | null
  metadata: JsonRecord | null
  created_at: string
}

type ProviderRunRow = {
  id: string
  conversation_id: string | null
  message_id: string | null
  model: string
  generation_id: string | null
  reservation_ref_id: string
  reserved_credits: number | string | null
  actual_credits: number | string | null
  status: string
  created_at: string
  reconciled_at: string | null
}

type MessageRow = {
  id: string
  conversation_id: string
  parent_id: string | null
  role: string
  tool_calls: unknown
  model_name: string | null
  created_at: string
}

type ConversationRow = {
  id: string
  project_id: string | null
  title: string | null
  created_at: string
  storage_mode: 'cloud' | 'local' | null
}

type ProjectRow = {
  id: string
  name: string
  created_at: string
  storage_mode: 'cloud' | 'local' | null
}

type SubscriptionRow = {
  id: string
  status: string
  plan_id: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
}

type PlanRow = {
  id: string
  plan_code: string
  display_name: string
}

type ProfileRow = {
  cached_current_credits: number | string | null
}

const router = express.Router()

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const round = (value: number, digits = 6): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const dayKey = (timestamp: string): string => {
  if (!timestamp) return 'unknown'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return date.toISOString().slice(0, 10)
}

const safeArray = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : [])

const parseToolCalls = (input: unknown): any[] => {
  if (Array.isArray(input)) return input
  if (input && typeof input === 'object') return [input]
  if (typeof input === 'string') {
    try {
      return parseToolCalls(JSON.parse(input))
    } catch {
      return []
    }
  }
  return []
}

const extractToolName = (toolCall: unknown): string | null => {
  if (!toolCall || typeof toolCall !== 'object') return null
  const candidate = toolCall as Record<string, unknown>
  const direct = typeof candidate.name === 'string' ? candidate.name : null
  const functionName =
    candidate.function && typeof candidate.function === 'object'
      ? typeof (candidate.function as Record<string, unknown>).name === 'string'
        ? ((candidate.function as Record<string, unknown>).name as string)
        : null
      : null
  const tool = direct || functionName
  return tool && tool.trim() ? tool.trim() : null
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.floor((sorted.length - 1) * p)
  return sorted[index]
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)

    const rangeDaysParam = Number(req.query.rangeDays)
    const rangeDays = Number.isFinite(rangeDaysParam) ? clamp(Math.trunc(rangeDaysParam), 1, 365) : 30
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId.trim() ? req.query.projectId.trim() : null
    const conversationId =
      typeof req.query.conversationId === 'string' && req.query.conversationId.trim()
        ? req.query.conversationId.trim()
        : null
    const modelFilter = typeof req.query.model === 'string' && req.query.model.trim() ? req.query.model.trim() : null
    const providerRunStatus =
      typeof req.query.providerRunStatus === 'string' && req.query.providerRunStatus.trim()
        ? req.query.providerRunStatus.trim()
        : null
    const toolNameFilter = typeof req.query.toolName === 'string' && req.query.toolName.trim() ? req.query.toolName.trim() : null

    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString()

    const [ledgerRes, runsRes, messagesRes, conversationsRes, projectsRes, subscriptionsRes, plansRes, profileRes] =
      await Promise.all([
        client
          .from('credits_ledger')
          .select('id, delta_credits, kind, external_ref_type, external_ref_id, message_id, conversation_id, metadata, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
        client
          .from('provider_runs')
          .select(
            'id, conversation_id, message_id, model, generation_id, reservation_ref_id, reserved_credits, actual_credits, status, created_at, reconciled_at'
          )
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
        client
          .from('messages')
          .select('id, conversation_id, parent_id, role, tool_calls, model_name, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
        client
          .from('conversations')
          .select('id, project_id, title, created_at, storage_mode')
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
        client
          .from('projects')
          .select('id, name, created_at, storage_mode')
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
        client.from('subscriptions').select('id, status, plan_id, current_period_end, cancel_at_period_end').limit(20),
        client.from('plans').select('id, plan_code, display_name'),
        client.from('profiles').select('cached_current_credits').limit(1).single(),
      ])

    if (ledgerRes.error) throw ledgerRes.error
    if (runsRes.error) throw runsRes.error
    if (messagesRes.error) throw messagesRes.error
    if (conversationsRes.error) throw conversationsRes.error
    if (projectsRes.error) throw projectsRes.error
    if (subscriptionsRes.error) throw subscriptionsRes.error
    if (plansRes.error) throw plansRes.error

    const ledgerRows = safeArray(ledgerRes.data as LedgerRow[])
    const providerRuns = safeArray(runsRes.data as ProviderRunRow[])
    const messages = safeArray(messagesRes.data as MessageRow[])
    const conversations = safeArray(conversationsRes.data as ConversationRow[])
    const projects = safeArray(projectsRes.data as ProjectRow[])
    const subscriptions = safeArray(subscriptionsRes.data as SubscriptionRow[])
    const plans = safeArray(plansRes.data as PlanRow[])
    const currentCredits = profileRes.data ? toNumber((profileRes.data as ProfileRow).cached_current_credits) : null

    const projectIdSet = new Set(
      projectId ? projects.filter(project => project.id === projectId).map(project => project.id) : projects.map(project => project.id)
    )

    const scopedConversations = conversations.filter(conversation => {
      if (conversationId && conversation.id !== conversationId) return false
      if (projectId && conversation.project_id !== projectId) return false
      if (!projectId && conversation.project_id && !projectIdSet.has(conversation.project_id)) return false
      return true
    })
    const scopedConversationIdSet = new Set(scopedConversations.map(conversation => conversation.id))

    const scopedMessages = messages.filter(message => scopedConversationIdSet.has(message.conversation_id))
    const messageConversationMap = new Map(scopedMessages.map(message => [message.id, message.conversation_id]))

    const scopedRuns = providerRuns.filter(run => {
      if (conversationId && run.conversation_id !== conversationId) return false
      if (projectId && run.conversation_id && !scopedConversationIdSet.has(run.conversation_id)) return false
      if (!projectId && !conversationId) return true
      return run.conversation_id ? scopedConversationIdSet.has(run.conversation_id) : true
    })

    const modelFilteredRuns = scopedRuns.filter(run => {
      if (modelFilter && run.model !== modelFilter) return false
      if (providerRunStatus && run.status !== providerRunStatus) return false
      return true
    })

    const scopedLedger = ledgerRows.filter(row => {
      if (!conversationId && !projectId) return true
      if (row.conversation_id && scopedConversationIdSet.has(row.conversation_id)) return true
      if (row.message_id) {
        const mappedConversationId = messageConversationMap.get(row.message_id)
        return mappedConversationId ? scopedConversationIdSet.has(mappedConversationId) : false
      }
      return false
    })

    const filteredLedger = scopedLedger.filter(row => {
      if (!modelFilter) return true
      const metadataModel =
        row.metadata && typeof row.metadata === 'object' && typeof row.metadata.model === 'string'
          ? row.metadata.model
          : null
      return metadataModel ? metadataModel === modelFilter : true
    })

    const filteredMessages = scopedMessages.filter(message => {
      if (!modelFilter) return true
      return message.model_name ? message.model_name === modelFilter : true
    })

    const availableModels = Array.from(
      new Set([
        ...scopedRuns.map(run => run.model).filter(Boolean),
        ...scopedMessages.map(message => message.model_name || '').filter(Boolean),
      ])
    ).sort()

    const availableToolNames = Array.from(
      new Set(
        scopedMessages.flatMap(message =>
          parseToolCalls(message.tool_calls)
            .map(call => extractToolName(call))
            .filter((name): name is string => Boolean(name))
        )
      )
    ).sort()

    const requestedToolCalls = filteredMessages.flatMap(message =>
      parseToolCalls(message.tool_calls)
        .map(call => extractToolName(call))
        .filter((name): name is string => Boolean(name))
    )

    const filteredToolCalls = toolNameFilter ? requestedToolCalls.filter(tool => tool === toolNameFilter) : requestedToolCalls

    const toolRequestedByName = filteredToolCalls.reduce<Record<string, number>>((acc, toolName) => {
      acc[toolName] = (acc[toolName] || 0) + 1
      return acc
    }, {})

    const messageCountByRole = filteredMessages.reduce<Record<string, number>>((acc, message) => {
      acc[message.role] = (acc[message.role] || 0) + 1
      return acc
    }, {})

    const messagesPerDay = filteredMessages.reduce<Record<string, number>>((acc, message) => {
      const key = dayKey(message.created_at)
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const childrenCountByParent = new Map<string, number>()
    const messageById = new Map(filteredMessages.map(message => [message.id, message]))
    for (const message of filteredMessages) {
      if (!message.parent_id) continue
      childrenCountByParent.set(message.parent_id, (childrenCountByParent.get(message.parent_id) || 0) + 1)
    }

    const branchPoints = Array.from(childrenCountByParent.values()).filter(count => count > 1).length

    const depthMemo = new Map<string, number>()
    const visiting = new Set<string>()
    const computeDepth = (id: string): number => {
      if (depthMemo.has(id)) return depthMemo.get(id) || 0
      if (visiting.has(id)) return 0
      visiting.add(id)
      const current = messageById.get(id)
      let depth = 0
      if (current?.parent_id && messageById.has(current.parent_id)) {
        depth = computeDepth(current.parent_id) + 1
      }
      visiting.delete(id)
      depthMemo.set(id, depth)
      return depth
    }

    const messageDepths = filteredMessages.map(message => computeDepth(message.id))
    const maxDepth = messageDepths.length > 0 ? Math.max(...messageDepths) : 0
    const avgDepth = messageDepths.length > 0 ? messageDepths.reduce((sum, value) => sum + value, 0) / messageDepths.length : 0

    const runsByStatus = modelFilteredRuns.reduce<Record<string, number>>((acc, run) => {
      acc[run.status] = (acc[run.status] || 0) + 1
      return acc
    }, {})

    const reconcileLagMinutes = modelFilteredRuns
      .filter(run => run.reconciled_at)
      .map(run => {
        const createdAt = new Date(run.created_at).getTime()
        const reconciledAt = new Date(run.reconciled_at as string).getTime()
        if (Number.isNaN(createdAt) || Number.isNaN(reconciledAt)) return 0
        return Math.max(0, (reconciledAt - createdAt) / 60000)
      })
      .filter(value => Number.isFinite(value))

    const withGenerationId = modelFilteredRuns.filter(run => Boolean(run.generation_id)).length
    const withMessageLink = modelFilteredRuns.filter(run => Boolean(run.message_id)).length
    const withConversationLink = modelFilteredRuns.filter(run => Boolean(run.conversation_id)).length
    const reconciledRuns = modelFilteredRuns.filter(run => run.status === 'reconciled').length

    const modelStatsMap = new Map<
      string,
      {
        runs: number
        totalActualCredits: number
        totalReservedCredits: number
        status: Record<string, number>
      }
    >()

    for (const run of modelFilteredRuns) {
      const key = run.model || 'unknown'
      const existing = modelStatsMap.get(key) || {
        runs: 0,
        totalActualCredits: 0,
        totalReservedCredits: 0,
        status: {},
      }
      const reservedCredits = toNumber(run.reserved_credits)
      const actualCredits = toNumber(run.actual_credits)
      existing.runs += 1
      existing.totalReservedCredits += reservedCredits
      existing.totalActualCredits += actualCredits || reservedCredits
      existing.status[run.status] = (existing.status[run.status] || 0) + 1
      modelStatsMap.set(key, existing)
    }

    const topModels = Array.from(modelStatsMap.entries())
      .map(([model, stat]) => ({
        model,
        runs: stat.runs,
        totalActualCredits: round(stat.totalActualCredits),
        avgActualCredits: round(stat.totalActualCredits / Math.max(1, stat.runs)),
        totalReservedCredits: round(stat.totalReservedCredits),
        status: stat.status,
      }))
      .sort((a, b) => b.totalActualCredits - a.totalActualCredits)

    const dailyLedgerMap = new Map<
      string,
      {
        date: string
        reservationCredits: number
        refundCredits: number
        adjustmentCredits: number
        monthlyAllocationCredits: number
        topupCredits: number
        netCreditsChange: number
      }
    >()

    for (const row of filteredLedger) {
      const key = dayKey(row.created_at)
      const existing = dailyLedgerMap.get(key) || {
        date: key,
        reservationCredits: 0,
        refundCredits: 0,
        adjustmentCredits: 0,
        monthlyAllocationCredits: 0,
        topupCredits: 0,
        netCreditsChange: 0,
      }
      const delta = toNumber(row.delta_credits)
      existing.netCreditsChange += delta

      if (row.kind === 'generation_reservation') {
        existing.reservationCredits += Math.abs(delta)
      } else if (row.kind === 'generation_refund') {
        existing.refundCredits += delta
      } else if (row.kind === 'generation_adjustment') {
        existing.adjustmentCredits += delta
      } else if (row.kind === 'monthly_allocation') {
        existing.monthlyAllocationCredits += delta
      } else if (row.kind === 'topup_credit') {
        existing.topupCredits += delta
      }

      dailyLedgerMap.set(key, existing)
    }

    const dailySpend = Array.from(dailyLedgerMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(row => ({
        ...row,
        reservationCredits: round(row.reservationCredits),
        refundCredits: round(row.refundCredits),
        adjustmentCredits: round(row.adjustmentCredits),
        monthlyAllocationCredits: round(row.monthlyAllocationCredits),
        topupCredits: round(row.topupCredits),
        netCreditsChange: round(row.netCreditsChange),
        netCreditsConsumed: round(-row.netCreditsChange),
      }))

    const generationLedgerKinds = new Set(['generation_reservation', 'generation_refund', 'generation_adjustment'])
    const totalGenerationDelta = filteredLedger
      .filter(row => generationLedgerKinds.has(row.kind))
      .reduce((sum, row) => sum + toNumber(row.delta_credits), 0)

    const totalReservedCredits = filteredLedger
      .filter(row => row.kind === 'generation_reservation')
      .reduce((sum, row) => sum + Math.abs(toNumber(row.delta_credits)), 0)

    const totalRefundCredits = filteredLedger
      .filter(row => row.kind === 'generation_refund')
      .reduce((sum, row) => sum + toNumber(row.delta_credits), 0)

    const totalAdjustmentCredits = filteredLedger
      .filter(row => row.kind === 'generation_adjustment')
      .reduce((sum, row) => sum + toNumber(row.delta_credits), 0)

    const activeDays = Object.keys(messagesPerDay).length
    const averageCreditsPerGeneration = modelFilteredRuns.length
      ? -totalGenerationDelta / Math.max(1, modelFilteredRuns.length)
      : 0

    const assistantMessageCount = filteredMessages.filter(message => message.role === 'assistant').length
    const attributedMessageIds = new Set<string>()
    for (const row of filteredLedger) {
      if (row.message_id) attributedMessageIds.add(row.message_id)
    }
    for (const run of modelFilteredRuns) {
      if (run.message_id) attributedMessageIds.add(run.message_id)
    }
    const attributedAssistantMessages = filteredMessages.filter(
      message => message.role === 'assistant' && attributedMessageIds.has(message.id)
    ).length

    const creditsBalance = currentCredits ?? null
    const burnRatePerDay = rangeDays > 0 ? Math.max(0, -totalGenerationDelta) / rangeDays : 0
    const projectedDaysRemaining =
      creditsBalance !== null && burnRatePerDay > 0 ? Math.max(0, creditsBalance / burnRatePerDay) : null

    const planById = new Map(plans.map(plan => [plan.id, plan]))
    const latestSubscription = subscriptions
      .slice()
      .sort((a, b) => {
        const aDate = a.current_period_end ? new Date(a.current_period_end).getTime() : 0
        const bDate = b.current_period_end ? new Date(b.current_period_end).getTime() : 0
        return bDate - aDate
      })[0]

    const activePlan = latestSubscription?.plan_id ? planById.get(latestSubscription.plan_id) : null

    const balanceTrend = (() => {
      if (creditsBalance === null) return [] as Array<{ date: string; credits: number }>
      const totalRangeDelta = dailySpend.reduce((sum, day) => sum + day.netCreditsChange, 0)
      let cursor = creditsBalance - totalRangeDelta
      return dailySpend.map(day => {
        cursor += day.netCreditsChange
        return {
          date: day.date,
          credits: round(cursor),
        }
      })
    })()

    const tokenMixByModelMap = new Map<string, { prompt: number; completion: number; reasoning: number; samples: number }>()
    for (const row of filteredLedger) {
      if (!row.metadata || typeof row.metadata !== 'object') continue
      const model = typeof row.metadata.model === 'string' ? row.metadata.model : null
      const tokens = row.metadata.tokens
      if (!model || !tokens || typeof tokens !== 'object') continue

      const tokenRecord = tokens as Record<string, unknown>
      const existing = tokenMixByModelMap.get(model) || {
        prompt: 0,
        completion: 0,
        reasoning: 0,
        samples: 0,
      }

      existing.prompt += toNumber(tokenRecord.prompt)
      existing.completion += toNumber(tokenRecord.completion)
      existing.reasoning += toNumber(tokenRecord.reasoning)
      existing.samples += 1
      tokenMixByModelMap.set(model, existing)
    }

    const tokenMixByModel = Array.from(tokenMixByModelMap.entries())
      .map(([model, stats]) => ({
        model,
        prompt: Math.round(stats.prompt),
        completion: Math.round(stats.completion),
        reasoning: Math.round(stats.reasoning),
        samples: stats.samples,
      }))
      .sort((a, b) => b.prompt + b.completion + b.reasoning - (a.prompt + a.completion + a.reasoning))

    res.json({
      rangeDays,
      filters: {
        applied: {
          projectId,
          conversationId,
          model: modelFilter,
          providerRunStatus,
          toolName: toolNameFilter,
        },
        available: {
          models: availableModels,
          providerRunStatuses: Array.from(new Set(scopedRuns.map(run => run.status))).sort(),
          toolNames: availableToolNames,
          projects: projects.map(project => ({ id: project.id, name: project.name, storage_mode: project.storage_mode })),
          conversations: scopedConversations.map(conversation => ({
            id: conversation.id,
            title: conversation.title,
            project_id: conversation.project_id,
            storage_mode: conversation.storage_mode,
          })),
        },
      },
      summary: {
        netCreditsConsumed: round(Math.max(0, -totalGenerationDelta)),
        totalReservedCredits: round(totalReservedCredits),
        totalRefundCredits: round(totalRefundCredits),
        totalAdjustmentCredits: round(totalAdjustmentCredits),
        averageCreditsPerGeneration: round(averageCreditsPerGeneration),
        averageCreditsPerAssistantMessage: round(
          assistantMessageCount ? Math.max(0, -totalGenerationDelta) / assistantMessageCount : 0
        ),
        messagesTotal: filteredMessages.length,
        conversationsCreated: scopedConversations.length,
        projectsCreated: projectId ? projects.filter(project => project.id === projectId).length : projects.length,
        activeDays,
      },
      spend: {
        daily: dailySpend,
        balanceTrend,
        burnRate: {
          creditsPerDay: round(burnRatePerDay),
          projectedDaysRemaining: projectedDaysRemaining === null ? null : round(projectedDaysRemaining, 2),
        },
      },
      models: {
        topByCredits: topModels,
        tokenMixByModel,
      },
      providerRuns: {
        statusCounts: runsByStatus,
        quality: {
          total: modelFilteredRuns.length,
          withGenerationIdPct: modelFilteredRuns.length ? round((withGenerationId / modelFilteredRuns.length) * 100, 2) : 0,
          withMessageLinkPct: modelFilteredRuns.length ? round((withMessageLink / modelFilteredRuns.length) * 100, 2) : 0,
          withConversationLinkPct: modelFilteredRuns.length
            ? round((withConversationLink / modelFilteredRuns.length) * 100, 2)
            : 0,
          reconciledPct: modelFilteredRuns.length ? round((reconciledRuns / modelFilteredRuns.length) * 100, 2) : 0,
          lastReconciledAt: modelFilteredRuns
            .map(run => run.reconciled_at)
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1) || null,
        },
        reconcileLagMinutes: {
          avg: reconcileLagMinutes.length
            ? round(reconcileLagMinutes.reduce((sum, value) => sum + value, 0) / reconcileLagMinutes.length, 2)
            : 0,
          p50: round(percentile(reconcileLagMinutes, 0.5), 2),
          p90: round(percentile(reconcileLagMinutes, 0.9), 2),
          max: reconcileLagMinutes.length ? round(Math.max(...reconcileLagMinutes), 2) : 0,
        },
      },
      activity: {
        messagesByRole: messageCountByRole,
        messagesPerDay: Object.entries(messagesPerDay)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        branching: {
          branchPoints,
          averageDepth: round(avgDepth, 2),
          maxDepth,
        },
      },
      tools: {
        requested: {
          total: filteredToolCalls.length,
          byName: toolRequestedByName,
        },
        jobs: {
          available: false,
          statusCounts: {},
          total: 0,
          topFailing: [],
          averageDurationMs: null,
        },
      },
      payments: {
        currentPlan: latestSubscription
          ? {
              subscriptionStatus: latestSubscription.status,
              currentPeriodEnd: latestSubscription.current_period_end,
              cancelAtPeriodEnd: latestSubscription.cancel_at_period_end,
              planCode: activePlan?.plan_code || null,
              planName: activePlan?.display_name || null,
            }
          : null,
        history: {
          monthlyAllocation: filteredLedger
            .filter(row => row.kind === 'monthly_allocation')
            .map(row => ({
              id: row.id,
              created_at: row.created_at,
              credits: round(toNumber(row.delta_credits)),
              external_ref_id: row.external_ref_id,
            }))
            .sort((a, b) => b.created_at.localeCompare(a.created_at)),
          topups: filteredLedger
            .filter(row => row.kind === 'topup_credit')
            .map(row => ({
              id: row.id,
              created_at: row.created_at,
              credits: round(toNumber(row.delta_credits)),
              external_ref_id: row.external_ref_id,
            }))
            .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        },
        currentCreditsBalance: creditsBalance,
      },
      dataQuality: {
        assistantMessagesWithCostPct: assistantMessageCount
          ? round((attributedAssistantMessages / assistantMessageCount) * 100, 2)
          : 0,
        assistantMessagesTotal: assistantMessageCount,
        assistantMessagesWithCost: attributedAssistantMessages,
      },
    })
  })
)

export default router
