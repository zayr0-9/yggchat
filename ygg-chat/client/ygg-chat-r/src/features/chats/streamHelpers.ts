import { StreamLineage, StreamState, StreamType } from './chatTypes'

/**
 * Creates an empty StreamState with default values
 */
export const createEmptyStreamState = (
  streamType: StreamType = 'primary',
  lineage: StreamLineage = {}
): StreamState => ({
  active: false,
  buffer: '',
  thinkingBuffer: '',
  toolCalls: [],
  events: [],
  messageId: null,
  error: null,
  finished: false,
  streamingMessageId: null,
  lineage,
  createdAt: new Date().toISOString(),
  streamType,
})

/**
 * Generates a unique stream ID based on stream type and context
 *
 * Stream ID formats:
 * - primary: UUID (e.g., "550e8400-e29b-41d4-a716-446655440000")
 * - subagent: "{parentStreamId}:sub:{shortUuid}" (e.g., "550e8400...:sub:a1b2c3d4")
 * - tool: "tool:{toolCallId}:{shortUuid}" (e.g., "tool:tc_123:a1b2c3d4")
 * - branch: "branch:{shortUuid}" (e.g., "branch:a1b2c3d4")
 */
export const generateStreamId = (
  type: StreamType,
  context?: {
    parentStreamId?: string
    toolCallId?: string
  }
): string => {
  const uuid = crypto.randomUUID()
  const shortUuid = uuid.slice(0, 8)

  switch (type) {
    case 'subagent':
      return context?.parentStreamId ? `${context.parentStreamId}:sub:${shortUuid}` : `sub:${uuid}`
    case 'tool':
      return context?.toolCallId ? `tool:${context.toolCallId}:${shortUuid}` : `tool:${uuid}`
    case 'branch':
      return `branch:${shortUuid}`
    default:
      return uuid
  }
}

/**
 * The default stream ID used for backward compatibility
 * When no streamId is provided, actions fall back to this ID
 */
export const DEFAULT_STREAM_ID = 'default'

/**
 * Checks if a given stream ID represents a subagent stream
 */
export const isSubagentStream = (streamId: string): boolean => {
  return streamId.includes(':sub:')
}

/**
 * Checks if a given stream ID represents a tool-spawned stream
 */
export const isToolStream = (streamId: string): boolean => {
  return streamId.startsWith('tool:')
}

/**
 * Extracts the parent stream ID from a subagent stream ID
 * Returns null if the stream is not a subagent stream
 */
export const getParentStreamId = (streamId: string): string | null => {
  if (!isSubagentStream(streamId)) return null
  const parts = streamId.split(':sub:')
  return parts[0] || null
}

/**
 * Maximum number of concurrent streams allowed
 * Prevents memory issues from too many active streams
 */
export const MAX_CONCURRENT_STREAMS = 10

/**
 * Time in ms after which finished/errored streams can be pruned
 */
export const STREAM_PRUNE_DELAY = 30000
