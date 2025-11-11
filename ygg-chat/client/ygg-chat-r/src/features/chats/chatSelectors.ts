import { createSelector } from '@reduxjs/toolkit'
import { MessageId } from '../../../../../shared/types'
import { RootState } from '../../store/store'

// Base selector
const selectChatState = (state: RootState) => state.chat

// Model selectors - Model selection is now managed by React Query (useSelectedModel hook)
export const selectProviderState = createSelector([selectChatState], chat => chat.providerState)

export const conversationContext = createSelector([selectChatState], chat => chat.conversation.context)

export const selectMultiReplyCount = createSelector([selectChatState], chat => chat.composition.multiReplyCount)

export const getSelectedNodes = createSelector([selectChatState], chat => chat.selectedNodes)

// Note: Model availability check should now be done using useModels React Query hook
// This selector is kept for backward compatibility but will always return false
export const selectIsModelAvailable = () => false

// Composition selectors
export const selectMessageInput = createSelector([selectChatState], chat => chat.composition.input)

export const selectInputContent = createSelector([selectMessageInput], input => input.content)

export const selectInputValid = createSelector(
  [selectChatState],
  chat => !chat.composition.validationError && chat.composition.input.content.trim().length > 0
)

export const selectValidationError = createSelector([selectChatState], chat => chat.composition.validationError)

// Streaming selectors
export const selectStreamState = createSelector([selectChatState], chat => chat.streaming)

export const selectStreamBuffer = createSelector([selectStreamState], stream => stream.buffer)

export const selectThinkingBuffer = createSelector([selectStreamState], stream => stream.thinkingBuffer)

export const selectStreamError = createSelector([selectStreamState], stream => stream.error)

export const selectStreamEvents = createSelector([selectStreamState], stream => stream.events)

export const selectIsStreaming = createSelector([selectStreamState], stream => stream.active)

// Note: selectCanSend is deprecated - use local canSendLocal in Chat.tsx component which checks selectedModel from React Query

export const selectSendingState = createSelector([selectChatState], chat => ({
  sending: chat.composition.sending,
  streaming: chat.streaming.active,
  error: chat.streaming.error,
}))

// Heimdall selectors
export const selectHeimdallState = createSelector([selectChatState], chat => chat.heimdall)
export const selectHeimdallData = createSelector([selectHeimdallState], h => h.treeData)
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
  h.loading = false
  h.error = null
})

// Note: selectModelState is deprecated - use useSelectedModel and useModels from useQueries.ts

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

export const selectBookmarkedMessages = createSelector(
  [selectConversationState],
  conversation => conversation.bookmarked
)

export const selectExcludedMessages = createSelector(
  [selectConversationState],
  conversation => conversation.excludedMessages
)

// Filter messages based on selected path (for branch navigation)
export const selectFilteredMessages = createSelector(
  [selectConversationMessages, selectCurrentPath],
  (messages, currentPath) => {
    // If no path is selected, show all messages (default behavior)
    if (!currentPath || currentPath.length === 0) {
      return messages
    }

    // Filter messages to only include those in the selected path
    const pathSet = new Set(currentPath)
    return messages.filter(message => pathSet.has(message.id))
  }
)

export const selectFocusedChatMessageId = createSelector(
  [selectConversationState],
  conversation => conversation.focusedChatMessageId
)

// Get messages for display (either filtered by path or all messages)
export const selectDisplayMessages = createSelector(
  [selectConversationMessages, selectCurrentPath],
  (messages, currentPath) => {
    // Primary: use currentPath (array of selected IDs) to pick messages in the same order
    if (Array.isArray(currentPath) && currentPath.length > 0) {
      const byId = new Map(messages.map(m => [m.id, m]))
      const selected = currentPath.map(id => byId.get(id)).filter((m): m is (typeof messages)[number] => Boolean(m))

      if (selected.length > 0) return selected

      // Fallback 1: filter by IDs (order chronologically)
      const pathSet = new Set(currentPath)
      const filtered = messages.filter(m => pathSet.has(m.id))
      if (filtered.length > 0) {
        return filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      }
    }

    // Fallback 2: show all messages chronologically (deduped)
    const unique = new Map<MessageId, (typeof messages)[number]>()
    for (const m of messages) if (!unique.has(m.id)) unique.set(m.id, m)
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
