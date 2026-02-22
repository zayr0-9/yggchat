import { Message } from './chatTypes'
import { MessageId } from '../../../../../shared/types'

const compareMessageIds = (a: MessageId, b: MessageId): number => {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  return String(a).localeCompare(String(b))
}

/**
 * Build a branch path for a given message id, based on a flat list of messages.
 * The path includes:
 * - Root -> ... -> target message (by following parent_id upwards)
 * - Then extends from target to the leaf by repeatedly following the first child
 *   (child with the lowest numeric id), matching the behavior used in Heimdall and URL hash handling.
 */
export function buildBranchPathForMessage(messages: Message[], messageId: MessageId): MessageId[] {
  if (!Array.isArray(messages) || messages.length === 0) return []

  const idToMsg = new Map<MessageId, Message>()
  const parentToChildren = new Map<MessageId, MessageId[]>()

  for (const message of messages) {
    idToMsg.set(message.id, message)
    const parentId = (message.parent_id ?? null) as MessageId | null
    if (parentId == null) continue

    const children = parentToChildren.get(parentId)
    if (children) {
      children.push(message.id)
    } else {
      parentToChildren.set(parentId, [message.id])
    }
  }

  if (!idToMsg.has(messageId)) return []

  for (const children of parentToChildren.values()) {
    children.sort(compareMessageIds)
  }

  // 1) Base path: root -> ... -> target
  const path: MessageId[] = []
  const visitedAncestors = new Set<MessageId>()
  let currentId: MessageId | null = messageId

  while (currentId !== null && !visitedAncestors.has(currentId)) {
    visitedAncestors.add(currentId)
    path.unshift(currentId)

    const message = idToMsg.get(currentId)
    currentId = (message?.parent_id ?? null) as MessageId | null
  }

  if (path.length === 0) return []

  // 2) Extend path to leaf by following the first child (lowest id) repeatedly
  let curId = path[path.length - 1]
  const visitedDescendants = new Set<MessageId>(path)

  while (true) {
    const children = parentToChildren.get(curId)
    if (!children || children.length === 0) break

    const firstChild = children[0]
    if (visitedDescendants.has(firstChild)) break

    path.push(firstChild)
    visitedDescendants.add(firstChild)
    curId = firstChild
  }

  return path
}
