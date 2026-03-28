export interface ResolveHermesExecutionPlanInput {
  providedSessionId?: string
  lineageSessionId?: string
  conversationSessionId?: string
  forkSession?: boolean
  resume?: boolean
}

export interface HermesExecutionPlan {
  sourceSessionId?: string
  forkSession: boolean
}

/**
 * Resolve which Hermes session should back the next execution.
 *
 * Continuations prefer the explicit/provided session, then the selected lineage,
 * then the conversation-level fallback.
 *
 * Branching/forked executions must remain lineage-isolated and therefore must not
 * silently fall back to the conversation-global session when no branch source exists.
 */
export function resolveHermesExecutionPlan(input: ResolveHermesExecutionPlanInput): HermesExecutionPlan {
  const shouldFork = Boolean(input.forkSession)

  if (input.resume === false) {
    return {
      sourceSessionId: undefined,
      forkSession: shouldFork,
    }
  }

  const sourceSessionId = shouldFork
    ? input.lineageSessionId || input.providedSessionId || undefined
    : input.providedSessionId || input.lineageSessionId || input.conversationSessionId || undefined

  return {
    sourceSessionId,
    forkSession: shouldFork,
  }
}
