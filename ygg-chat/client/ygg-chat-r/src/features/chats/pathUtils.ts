import { Message } from './chatTypes'
import { MessageId } from '../../../../../shared/types'

/**
 * Build a branch path for a given message id, based on a flat list of messages.
 * The path includes:
 * - Root -> ... -> target message (by following parent_id upwards)
 * - Then extends from target to the leaf by repeatedly following the first child
 *   (child with the lowest numeric id), matching the behavior used in Heimdall and URL hash handling.
 */
export function buildBranchPathForMessage(messages: Message[], messageId: MessageId): MessageId[] {
  if (!Array.isArray(messages) || messages.length === 0) return []

  const idToMsg = new Map<MessageId, Message>(messages.map(m => [m.id, m]))
  if (!idToMsg.has(messageId)) return []

  // 1) Base path: root -> ... -> target
  const path: MessageId[] = []
  let currentId: MessageId | null = messageId
  while (currentId !== null) {
    path.unshift(currentId)
    const message = idToMsg.get(currentId)
    currentId = (message?.parent_id ?? null) as MessageId | null
  }

  // 2) Extend path to leaf by following the first child (lowest id) repeatedly
  let curId = path[path.length - 1]
  while (true) {
    const children = messages
      .filter(m => m.parent_id === curId)
      .sort((a, b) => {
        // For numeric IDs, use numeric comparison; for strings, use string comparison
        if (typeof a.id === 'number' && typeof b.id === 'number') {
          return a.id - b.id
        }
        return String(a.id).localeCompare(String(b.id))
      })
    if (children.length === 0) break
    const firstChild = children[0]
    path.push(firstChild.id)
    curId = firstChild.id
  }

  return path
}
