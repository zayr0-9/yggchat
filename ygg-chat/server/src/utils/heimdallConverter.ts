// server/src/utils/heimdallConverter.ts

import { MessageId } from '../../../shared/types'
import { Message } from '../database/models'

// Types matching Heimdall component expectations
interface ChatNode {
  id: string
  message: string
  sender: 'user' | 'assistant'
  children: ChatNode[]
}

/**
 * Converts flat array of messages from database into tree structure for Heimdall component
 * @param messages - Array of messages from MessageService.getByConversation()
 * @returns Root ChatNode or null if no valid tree can be built
 */
export function convertMessagesToHeimdall(messages: Message[]): ChatNode | null {
  if (!messages || messages.length === 0) return null

  // Find root messages (parent_id is null)
  const rootMessages = messages.filter(msg => msg.parent_id === null)

  if (rootMessages.length === 0) return null

  // When there are multiple root messages (multiple independent branches),
  // we build each root subtree and attach them to a synthetic wrapper node.
  // This guarantees the function still returns a single `ChatNode` as expected
  // by the Heimdall component while preserving **all** messages.

  // Recursive function to build tree structure
  function buildNode(message: Message): ChatNode {
    // Find all direct children of this message
    const children = messages
      .filter(msg => msg.parent_id === message.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(buildNode) // Recursively build each child

    return {
      id: message.id.toString(),
      message: message.content,
      sender: message.role === 'user' ? 'user' : 'assistant', // Map role to sender
      children,
    }
  }

  // If only one root message, return it directly to keep the previous behaviour
  if (rootMessages.length === 1) {
    return buildNode(rootMessages[0])
  }

  // Multiple roots → create a synthetic root node that contains each root branch.
  const rootChildren = rootMessages
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map(buildNode)

  return {
    id: 'root',
    message: 'Conversation',
    // Choose a fixed sender (assistant) as the synthetic node is not an actual message
    sender: 'assistant',
    children: rootChildren,
  }
}

/**
 * Alternative version that handles multiple conversation trees
 * Returns array of ChatNodes if there are multiple root messages
 */
export function convertMessagesToHeimdallMultiRoot(messages: Message[]): ChatNode[] {
  if (!messages || messages.length === 0) return []

  // Find all root messages (parent_id is null)
  const rootMessages = messages.filter(msg => msg.parent_id === null)

  if (rootMessages.length === 0) return []

  // Sort roots by creation time
  const sortedRoots = rootMessages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  // Recursive function to build tree structure
  function buildNode(message: Message): ChatNode {
    const children = messages
      .filter(msg => msg.parent_id === message.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(buildNode)

    return {
      id: message.id.toString(),
      message: message.content,
      sender: message.role === 'user' ? 'user' : 'assistant',
      children,
    }
  }

  return sortedRoots.map(buildNode)
}

/**
 * Utility function to validate and debug tree structure
 * Useful for development and troubleshooting
 */
export function debugMessageTree(messages: Message[]): void {
  const roots = messages.filter(msg => msg.parent_id === null)

  const childCounts = new Map<MessageId, number>()
  messages.forEach(msg => {
    if (msg.parent_id != null) {
      // covers both null and undefined
      const parentId = msg.parent_id
      const count = childCounts.get(parentId) ?? 0
      childCounts.set(parentId, count + 1)
    }
  })

  // Check for orphaned messages
  const orphans = messages.filter(msg => msg.parent_id !== null && !messages.some(m => m.id === msg.parent_id))

  if (orphans.length > 0) {
    console.warn(
      '⚠️ Found orphaned messages:',
      orphans.map(o => o.id)
    )
  }

  // Display tree structure
  const tree = convertMessagesToHeimdall(messages)
  if (tree) {
    logTreeStructure(tree, 0)
  }
}

/**
 * Helper function to log tree structure in a readable format
 */
function logTreeStructure(node: ChatNode, depth: number): void {
  const indent = '  '.repeat(depth)
  const truncatedMessage = node.message.slice(0, 50) + (node.message.length > 50 ? '...' : '')

  node.children.forEach(child => {
    logTreeStructure(child, depth + 1)
  })
}

/**
 * Utility to get tree statistics
 */
export function getMessageTreeStats(messages: Message[]): {
  totalMessages: number
  rootMessages: number
  maxDepth: number
  branchPoints: number
} {
  const roots = messages.filter(msg => msg.parent_id === null)

  let maxDepth = 0
  let branchPoints = 0

  const calculateDepth = (messageId: MessageId, currentDepth: number = 0): number => {
    maxDepth = Math.max(maxDepth, currentDepth)

    const children = messages.filter(msg => msg.parent_id === messageId)

    if (children.length > 1) {
      branchPoints++
    }

    if (children.length === 0) {
      return currentDepth
    }

    return Math.max(...children.map(child => calculateDepth(child.id, currentDepth + 1)))
  }

  roots.forEach(root => calculateDepth(root.id))

  return {
    totalMessages: messages.length,
    rootMessages: roots.length,
    maxDepth,
    branchPoints,
  }
}
