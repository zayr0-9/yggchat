import { describe, expect, it } from 'vitest'
import { resolveHermesExecutionPlan } from '../hermesExecutionPlanner.js'

describe('resolveHermesExecutionPlan', () => {
  it('prefers provided session for continuation sends', () => {
    const plan = resolveHermesExecutionPlan({
      providedSessionId: 'provided-session',
      lineageSessionId: 'lineage-session',
      conversationSessionId: 'conversation-session',
      forkSession: false,
      resume: true,
    })

    expect(plan).toEqual({
      sourceSessionId: 'provided-session',
      forkSession: false,
    })
  })

  it('falls back to lineage then conversation session for continuation sends', () => {
    expect(
      resolveHermesExecutionPlan({
        lineageSessionId: 'lineage-session',
        conversationSessionId: 'conversation-session',
        forkSession: false,
      })
    ).toEqual({
      sourceSessionId: 'lineage-session',
      forkSession: false,
    })

    expect(
      resolveHermesExecutionPlan({
        conversationSessionId: 'conversation-session',
        forkSession: false,
      })
    ).toEqual({
      sourceSessionId: 'conversation-session',
      forkSession: false,
    })
  })

  it('keeps forked executions lineage-isolated', () => {
    const plan = resolveHermesExecutionPlan({
      providedSessionId: 'provided-session',
      lineageSessionId: 'lineage-session',
      conversationSessionId: 'conversation-session',
      forkSession: true,
      resume: true,
    })

    expect(plan).toEqual({
      sourceSessionId: 'lineage-session',
      forkSession: true,
    })
  })

  it('does not silently fall back to conversation-global session for forks', () => {
    const plan = resolveHermesExecutionPlan({
      conversationSessionId: 'conversation-session',
      forkSession: true,
      resume: true,
    })

    expect(plan).toEqual({
      sourceSessionId: undefined,
      forkSession: true,
    })
  })

  it('drops all session reuse when resume is explicitly false', () => {
    const plan = resolveHermesExecutionPlan({
      providedSessionId: 'provided-session',
      lineageSessionId: 'lineage-session',
      conversationSessionId: 'conversation-session',
      forkSession: true,
      resume: false,
    })

    expect(plan).toEqual({
      sourceSessionId: undefined,
      forkSession: true,
    })
  })
})
