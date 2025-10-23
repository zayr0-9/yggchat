// Types
export type {
  ChatState,
  CompositionState,
  Message,
  MessageInput,
  Model,
  ModelSelectionPayload,
  ModelsResponse,
  ModelState,
  SendMessagePayload,
  StreamChunk,
  StreamState,
} from './chatTypes'

// Slice
export { default as chatReducer, chatSliceActions } from './chatSlice'

// Async actions
// Note: Model fetching thunks (fetchModels, fetchModelsForCurrentProvider, etc.)
// have been migrated to React Query. See hooks/useQueries.ts for useModels, useRecentModels, useRefreshModels
export {
  abortStreaming,
  deleteMessage,
  editMessageWithBranching,
  refreshCurrentPathAfterDelete,
  selectModel,
  sendMessage,
  sendMessageToBranch,
  updateMessage,
} from './chatActions'

// Selectors - grouped by feature
// Note: selectModels, selectModelsLoading, selectModelsError removed - use React Query hooks instead
export {
  conversationContext,
  HeimdallDataReset,
  selectBookmarkedMessages,
  // Combined selectors
  selectCanSend,
  selectConversationMessages,
  selectConversationState,
  selectCurrentConversationId,
  selectCurrentPath,
  selectDefaultModel,
  selectDisplayMessages,
  selectEffectiveModel,
  selectExcludedMessages,
  selectFilteredMessages,
  selectFocusedChatMessageId,
  selectInputContent,
  selectInputValid,
  selectIsModelAvailable,
  selectIsStreaming,
  // Composition selectors
  selectMessageInput,
  // UI selectors
  selectModelSelectorOpen,
  selectModelState,
  selectProviderState,
  selectSelectedModel,
  selectSendingState,
  selectStreamBuffer,
  selectStreamError,
  // Streaming selectors
  selectStreamState,
  selectValidationError,
} from './chatSelectors'

// Convenience re-exports
// New async thunks
export {
  fetchConversationMessages,
  fetchMessageTree,
  initializeConversationData,
  initializeUserAndConversation,
  updateConversationTitle,
} from './chatActions'

// New selectors for Heimdall and initialization
export {
  selectHeimdallCompactMode,
  selectHeimdallData,
  selectHeimdallError,
  selectHeimdallLoading,
  selectHeimdallState,
  selectInitializationError,
  selectInitializationLoading,
  selectInitializationState,
  selectMultiReplyCount,
} from './chatSelectors'

export { chatSliceActions as actions } from './chatSlice'
