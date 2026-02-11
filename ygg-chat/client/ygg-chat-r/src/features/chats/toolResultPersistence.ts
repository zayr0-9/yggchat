export interface ToolResultPersistencePolicy {
  timeoutMs: number
  maxRetries: number
  baseBackoffMs: number
  maxBackoffMs: number
  jitterRatio: number
}

export const TOOL_RESULT_PERSISTENCE_POLICY: ToolResultPersistencePolicy = {
  timeoutMs: 8000,
  maxRetries: 3,
  baseBackoffMs: 500,
  maxBackoffMs: 5000,
  jitterRatio: 0.25,
}

export interface PersistToolResultsWithFallbackParams<TContentBlocks = any[]> {
  attemptPersist: () => Promise<void>
  updatedContentBlocks: TContentBlocks
  conversationId?: string | null
  streamId?: string | null
  messageId?: string | null
  policy?: Partial<ToolResultPersistencePolicy>
  contextLabel?: string
}

export interface PersistToolResultsWithFallbackResult<TContentBlocks = any[]> {
  updatedContentBlocks: TContentBlocks
  persistedInline: boolean
  backgroundRetryScheduled: boolean
}

const mergePolicy = (policy?: Partial<ToolResultPersistencePolicy>): ToolResultPersistencePolicy => ({
  ...TOOL_RESULT_PERSISTENCE_POLICY,
  ...(policy || {}),
})

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

const jitteredBackoff = (attempt: number, policy: ToolResultPersistencePolicy): number => {
  const exponential = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * 2 ** Math.max(0, attempt - 1))
  const jitterWindow = Math.max(0, exponential * policy.jitterRatio)
  const jitter = Math.floor(Math.random() * (jitterWindow + 1))
  return exponential + jitter
}

const withTimeout = async <T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race<T>([
      operation(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

const scheduleBackgroundRetries = (params: {
  attemptPersist: () => Promise<void>
  conversationId?: string | null
  streamId?: string | null
  messageId?: string | null
  policy: ToolResultPersistencePolicy
  contextLabel?: string
}) => {
  const { attemptPersist, conversationId, streamId, messageId, policy, contextLabel } = params

  void (async () => {
    for (let attempt = 1; attempt <= policy.maxRetries; attempt++) {
      const delayMs = jitteredBackoff(attempt, policy)
      await sleep(delayMs)

      try {
        await withTimeout(attemptPersist, policy.timeoutMs)
        console.warn('[tool-result-persistence] background persist recovered', {
          contextLabel,
          conversationId,
          streamId,
          messageId,
          attempt,
        })
        return
      } catch (error) {
        const exhausted = attempt === policy.maxRetries
        console.warn('[tool-result-persistence] background persist retry failed', {
          contextLabel,
          conversationId,
          streamId,
          messageId,
          attempt,
          maxRetries: policy.maxRetries,
          exhausted,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  })().catch(error => {
    console.warn('[tool-result-persistence] background retry loop crashed', {
      contextLabel,
      conversationId,
      streamId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

export const persistToolResultsWithFallback = async <TContentBlocks = any[]>(
  params: PersistToolResultsWithFallbackParams<TContentBlocks>
): Promise<PersistToolResultsWithFallbackResult<TContentBlocks>> => {
  const { attemptPersist, updatedContentBlocks, conversationId, streamId, messageId, contextLabel } = params
  const policy = mergePolicy(params.policy)

  try {
    await withTimeout(attemptPersist, policy.timeoutMs)
    return {
      updatedContentBlocks,
      persistedInline: true,
      backgroundRetryScheduled: false,
    }
  } catch (error) {
    console.warn('[tool-result-persistence] inline persist failed, continuing with fallback', {
      contextLabel,
      conversationId,
      streamId,
      messageId,
      timeoutMs: policy.timeoutMs,
      maxRetries: policy.maxRetries,
      error: error instanceof Error ? error.message : String(error),
    })

    scheduleBackgroundRetries({
      attemptPersist,
      conversationId,
      streamId,
      messageId,
      policy,
      contextLabel,
    })

    return {
      updatedContentBlocks,
      persistedInline: false,
      backgroundRetryScheduled: true,
    }
  }
}
