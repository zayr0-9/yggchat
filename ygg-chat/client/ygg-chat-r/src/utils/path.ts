// utils/path.ts
// Utility functions related to conversation/message tree navigation
// ---------------------------------------------------------------
// getParentPath walks up the parent_id chain of a message and returns the full
// path (inclusive) from the root ancestor down to the target message.
//
// Usage example:
// const path = getParentPath(messages, targetMessageId)
// dispatch(chatActions.conversationPathSet(path))
//
// The function is kept generic to avoid coupling with Redux state. Any array of
// objects that at least have `id` and `parent_id` fields can be used.

export interface HasParentId {
  id: number
  parent_id?: number | null
}

/**
 * Build an array of ancestor IDs from root to the specified target message.
 *
 * @param messages   All messages in the conversation (flat array).
 * @param targetId   ID of the message whose path you want.
 * @returns          Array of IDs starting at the root ancestor and ending at targetId.
 */
export const getParentPath = <T extends HasParentId>(
  messages: T[],
  targetId: number
): number[] => {
  // Build quick lookup table for O(1) parent traversal
  const idToMsg = new Map<number, T>(messages.map(m => [m.id, m]))

  const path: number[] = []
  let current: T | undefined = idToMsg.get(targetId)

  while (current) {
    path.unshift(current.id)
    current = current.parent_id ? idToMsg.get(current.parent_id) : undefined
  }

  return path
}
