import { createSelector } from '@reduxjs/toolkit'
import { MessageId } from '../../../../../shared/types'
import { RootState } from '../../store/store'

// Base selector
const selectChatState = (state: RootState) => state.chat

// Top-level selectors
export const conversationContext = createSelector([selectChatState], chat => chat.conversation.context)
export const selectProviderState = createSelector([selectChatState], chat => chat.providerState)
export const selectMultiReplyCount = createSelector([selectChatState], chat => chat.composition.multiReplyCount)
export const getSelectedNodes = createSelector([selectChatState], chat => chat.selectedNodes)
export const selectOperationMode = createSelector([selectChatState], chat => chat.operationMode)

// Deprecated model availability selector (kept for backward compatibility)
export const selectIsModelAvailable = () => false

// Composition selectors
export const selectMessageInput = createSelector([selectChatState], chat => chat.composition.input)
export const selectInputContent = createSelector([selectMessageInput], input => input.content)
export const selectInputValid = createSelector(
  [selectChatState],
  chat => !chat.composition.validationError && chat.composition.input.content.trim().length > 0
)
export const selectValidationError = createSelector([selectChatState], chat => chat.composition.validationError)

// ============================================================================
// Multi-Stream Selectors
// ============================================================================

// Base streaming root state selector
export const selectStreamingRoot = createSelector([selectChatState], chat => chat.streaming)

// All active stream IDs
export const selectActiveStreamIds = createSelector([selectStreamingRoot], streaming => streaming.activeIds)

// Check if any stream is active
export const selectIsAnyStreaming = createSelector([selectActiveStreamIds], activeIds => activeIds.length > 0)

// Get the primary stream ID
export const selectPrimaryStreamId = createSelector([selectStreamingRoot], streaming => streaming.primaryStreamId)

// Get stream state by ID (returns null if not found)
export const selectStreamStateById = (state: RootState, streamId: string) => state.chat.streaming.byId[streamId] ?? null

// Get primary stream state
export const selectPrimaryStreamState = createSelector(
  [selectStreamingRoot, selectPrimaryStreamId],
  (streaming, primaryId) => (primaryId ? streaming.byId[primaryId] : null)
)

// ============================================================================
// Per-Stream Selector Factories (for use with specific streamIds)
// ============================================================================

// Factory for creating per-stream buffer selector
export const makeSelectStreamBuffer = (streamId: string) =>
  createSelector([selectStreamingRoot], streaming => streaming.byId[streamId]?.buffer ?? '')

// Factory for creating per-stream thinking buffer selector
export const makeSelectThinkingBuffer = (streamId: string) =>
  createSelector([selectStreamingRoot], streaming => streaming.byId[streamId]?.thinkingBuffer ?? '')

// Factory for creating per-stream events selector
export const makeSelectStreamEvents = (streamId: string) =>
  createSelector([selectStreamingRoot], streaming => streaming.byId[streamId]?.events ?? [])

// Factory for creating per-stream error selector
export const makeSelectStreamError = (streamId: string) =>
  createSelector([selectStreamingRoot], streaming => streaming.byId[streamId]?.error ?? null)

// Factory for creating per-stream active status selector
export const makeSelectIsStreaming = (streamId: string) =>
  createSelector([selectStreamingRoot], streaming => streaming.byId[streamId]?.active ?? false)

// Factory for creating per-stream tool calls selector
export const makeSelectStreamToolCalls = (streamId: string) =>
  createSelector([selectStreamingRoot], streaming => streaming.byId[streamId]?.toolCalls ?? [])

// Factory for creating per-stream message ID selector
export const makeSelectStreamMessageId = (streamId: string) =>
  createSelector([selectStreamingRoot], streaming => streaming.byId[streamId]?.messageId ?? null)

// ============================================================================
// Legacy Selectors (backward compatibility - look at primary stream)
// ============================================================================

// Legacy: selectStreamState now returns the root streaming state
export const selectStreamState = selectStreamingRoot

// Legacy: buffer from primary stream
export const selectStreamBuffer = createSelector([selectPrimaryStreamState], stream => stream?.buffer ?? '')

// Legacy: thinking buffer from primary stream
export const selectThinkingBuffer = createSelector([selectPrimaryStreamState], stream => stream?.thinkingBuffer ?? '')

// Legacy: error from primary stream
export const selectStreamError = createSelector([selectPrimaryStreamState], stream => stream?.error ?? null)

// Legacy: events from primary stream
export const selectStreamEvents = createSelector([selectPrimaryStreamState], stream => stream?.events ?? [])

// Legacy: active status from primary stream
export const selectIsStreaming = createSelector([selectPrimaryStreamState], stream => stream?.active ?? false)

// Legacy: sending state - now checks if ANY stream is active
export const selectSendingState = createSelector([selectChatState, selectActiveStreamIds], (chat, activeIds) => ({
  sending: chat.composition.sending,
  compacting: chat.composition.compacting,
  streaming: activeIds.length > 0,
  error: null, // Error now per-stream, use selectStreamError for specific stream
}))

// ============================================================================
// Subagent/Hierarchy Selectors
// ============================================================================

// Get all streams that are children of a parent stream
export const selectChildStreams = (parentStreamId: string) =>
  createSelector([selectStreamingRoot], streaming =>
    Object.entries(streaming.byId)
      .filter(([, state]) => state.lineage.parentStreamId === parentStreamId)
      .map(([id, state]) => ({ id, ...state }))
  )

// Get all streams originating from a specific message
export const selectStreamsByOriginMessage = (messageId: MessageId) =>
  createSelector([selectStreamingRoot], streaming =>
    Object.entries(streaming.byId)
      .filter(([, state]) => state.lineage.originMessageId === messageId)
      .map(([id, state]) => ({ id, ...state }))
  )

// Get all streams belonging to a specific branch root
export const selectStreamsByBranchRoot = (rootMessageId: MessageId) =>
  createSelector([selectStreamingRoot], streaming =>
    Object.entries(streaming.byId)
      .filter(([, state]) => state.lineage.rootMessageId === rootMessageId)
      .map(([id, state]) => ({ id, ...state }))
  )

// Get all active subagent streams
export const selectActiveSubagentStreams = createSelector([selectStreamingRoot], streaming =>
  Object.entries(streaming.byId)
    .filter(([, state]) => state.active && state.streamType === 'subagent')
    .map(([id, state]) => ({ id, ...state }))
)

// Get stream count by type
export const selectStreamCountByType = createSelector([selectStreamingRoot], streaming => {
  const counts = { primary: 0, subagent: 0, tool: 0, branch: 0 }
  for (const stream of Object.values(streaming.byId)) {
    if (stream.active) {
      counts[stream.streamType]++
    }
  }
  return counts
})

// Get the stream that should be displayed for the current view
// This considers the current path and returns the most relevant active stream
export const selectCurrentViewStream = createSelector(
  [selectStreamingRoot, (state: RootState) => state.chat.conversation.currentPath],
  (streaming, currentPath) => {
    // const lastMessageInPath = currentPath.length > 0 ? currentPath[currentPath.length - 1] : null
    const activeStreams = Object.entries(streaming.byId).filter(([, s]) => s.active)

    // Only log when there are active streams
    if (activeStreams.length > 0) {
      // console.log('[StreamSelector] lastInPath:', lastMessageInPath, 'activeStreams:', activeStreams.map(([id, s]) => ({
      //   id: id.slice(-8),
      //   root: s.lineage.rootMessageId?.slice(0, 8),
      // })))
    }

    // First, try to find an active stream whose rootMessageId (target parent) matches the current path
    // rootMessageId is the parent of the streaming message - updated when user message is created
    for (const [id, stream] of Object.entries(streaming.byId)) {
      if (!stream.active) continue

      const rootMsgId = stream.lineage.rootMessageId

      // Match ONLY if rootMessageId is in current path (streaming msg is on this branch)
      if (rootMsgId && currentPath.includes(rootMsgId)) {
        return { id, ...stream }
      }
    }

    // If no branch-specific stream found, return primary stream if active
    if (streaming.primaryStreamId) {
      const primaryStream = streaming.byId[streaming.primaryStreamId]
      if (primaryStream?.active) {
        // console.log('[StreamSelector] fallback to primary')
        return { id: streaming.primaryStreamId, ...primaryStream }
      }
    }

    // Return any active stream as fallback
    for (const [id, stream] of Object.entries(streaming.byId)) {
      if (stream.active) {
        // console.log('[StreamSelector] fallback to any:', id.slice(-8))
        return { id, ...stream }
      }
    }

    return null
  }
)

// Get all active streams with their IDs (for multi-stream UI)
export const selectAllActiveStreams = createSelector([selectStreamingRoot], streaming =>
  Object.entries(streaming.byId)
    .filter(([, state]) => state.active)
    .map(([id, state]) => ({ id, ...state }))
)

// Heimdall selectors
export const selectHeimdallState = createSelector([selectChatState], chat => chat.heimdall)
export const selectHeimdallData = createSelector([selectHeimdallState], h => h.treeData)
export const selectHeimdallSubagentMap = createSelector([selectHeimdallState], h => h.subagentMap)
export const selectHeimdallLoading = createSelector([selectHeimdallState], h => h.loading)
export const selectHeimdallError = createSelector([selectHeimdallState], h => h.error)
export const selectHeimdallCompactMode = createSelector([selectHeimdallState], h => h.compactMode)

// Initialization selectors
export const selectInitializationState = createSelector([selectChatState], chat => chat.initialization)
export const selectInitializationLoading = createSelector([selectInitializationState], i => i.loading)
export const selectInitializationError = createSelector([selectInitializationState], i => i.error)

// UI selectors
export const selectModelSelectorOpen = createSelector([selectChatState], chat => chat.ui.modelSelectorOpen)
export const HeimdallDataReset = createSelector([selectHeimdallState], h => {
  h.treeData = null
  h.subagentMap = {}
  h.loading = false
  h.error = null
})

// Conversation selectors
export const selectConversationState = createSelector([selectChatState], chat => chat.conversation)
export const selectCurrentConversationId = createSelector(
  [selectConversationState],
  conversation => conversation.currentConversationId
)
export const selectConversationMessages = createSelector(
  [selectConversationState],
  conversation => conversation.messages
)
export const selectCurrentPath = createSelector([selectConversationState], conversation => conversation.currentPath)
export const selectCcCwd = createSelector([selectConversationState], conversation => conversation.ccCwd)
export const selectBookmarkedMessages = createSelector(
  [selectConversationState],
  conversation => conversation.bookmarked
)
export const selectExcludedMessages = createSelector(
  [selectConversationState],
  conversation => conversation.excludedMessages
)

export const selectFilteredMessages = createSelector(
  [selectConversationMessages, selectCurrentPath],
  (messages, currentPath) => {
    if (!currentPath || currentPath.length === 0) return messages
    const pathSet = new Set(currentPath)
    return messages.filter(message => pathSet.has(message.id))
  }
)

export const selectFocusedChatMessageId = createSelector(
  [selectConversationState],
  conversation => conversation.focusedChatMessageId
)

export const selectDisplayMessages = createSelector(
  [selectConversationMessages, selectCurrentPath],
  (messages, currentPath) => {
    const isPersistentGlobalAgentType = (value: string | null | undefined): boolean =>
      value === 'persistent_agent' || value === 'persistent_agent_summary'

    // Keep legacy behavior (hide ex_agent) for normal chats, but show ex_agent in
    // persistent global-agent conversations so system-project chats render correctly.
    const shouldShowExAgent = messages.some(
      message => message.role === 'ex_agent' && isPersistentGlobalAgentType(message.ex_agent_type)
    )

    const displayableMessages = shouldShowExAgent ? messages : messages.filter(message => message.role !== 'ex_agent')

    if (Array.isArray(currentPath) && currentPath.length > 0) {
      const byId = new Map(displayableMessages.map(m => [m.id, m]))
      const selected = currentPath
        .map(id => byId.get(id))
        .filter((m): m is (typeof displayableMessages)[number] => Boolean(m))
      if (selected.length > 0) return selected

      const pathSet = new Set(currentPath)
      const filtered = displayableMessages.filter(m => pathSet.has(m.id))
      if (filtered.length > 0) {
        return filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      }
    }

    const unique = new Map<MessageId, (typeof displayableMessages)[number]>()
    for (const m of displayableMessages) if (!unique.has(m.id)) unique.set(m.id, m)
    return [...unique.values()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }
)

// Tools selectors
export const selectTools = createSelector([selectChatState], chat => chat.tools)
export const selectEnabledTools = createSelector([selectTools], tools => tools.filter(tool => tool.enabled))
export const selectToolByName = createSelector(
  [selectTools, (_state: RootState, toolName: string) => toolName],
  (tools, toolName) => tools.find(tool => tool.name === toolName)
)

// CC Slash Commands selector
export const selectCCSlashCommands = createSelector([selectChatState], chat => chat.ccSlashCommands)
