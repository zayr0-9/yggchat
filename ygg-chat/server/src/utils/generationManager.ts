// server/src/utils/generationManager.ts
import { MessageId } from '../../../shared/types'

const controllers = new Map<MessageId, AbortController>()
const abortingGenerations = new Set<MessageId>()

export function createGeneration(messageId: MessageId) {
  const controller = new AbortController()
  controllers.set(messageId, controller)
  return { id: messageId, controller }
}

export function getController(messageId: MessageId): AbortController | undefined {
  return controllers.get(messageId)
}

export function getSignal(messageId: MessageId): AbortSignal | undefined {
  return controllers.get(messageId)?.signal
}

export function abortGeneration(messageId: MessageId): boolean {
  // Mark as aborting to prevent clearGeneration from removing it
  abortingGenerations.add(messageId)

  const c = controllers.get(messageId)
  if (!c) {
    abortingGenerations.delete(messageId)
    return false
  }
  try {
    c.abort()
  } finally {
    controllers.delete(messageId)
    abortingGenerations.delete(messageId)
  }
  return true
}

export function clearGeneration(messageId: MessageId): void {
  // Don't clear if currently being aborted
  if (abortingGenerations.has(messageId)) {
    return
  }
  controllers.delete(messageId)
}
