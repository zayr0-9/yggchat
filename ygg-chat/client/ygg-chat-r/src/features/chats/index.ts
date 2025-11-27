// Types
export type {
  CCSessionInfo,
  ChatState,
  CompositionState,
  Message,
  MessageInput,
  Model,
  ModelsResponse,
  SendCCBranchPayload,
  SendCCMessagePayload,
  SendMessagePayload,
  StreamChunk,
  StreamState,
} from './chatTypes'

// Slice
export { default as chatReducer, chatSliceActions } from './chatSlice'

// Async actions
// Note: Model selection (selectModel) has been migrated to React Query. See hooks/useQueries.ts for useSelectModel
// Model fetching thunks (fetchModels, fetchModelsForCurrentProvider, etc.) have been migrated to React Query
export {
  abortStreaming,
  deleteMessage,
  editMessageWithBranching,
  getCCSessionInfo,
  refreshCurrentPathAfterDelete,
  respondToToolPermission,
  respondToToolPermissionAndEnableAll,
  sendCCBranch,
  sendCCMessage,
  sendMessage,
  sendMessageToBranch,
  syncConversationToLocal,
  updateMessage,
} from './chatActions'

// Selectors - grouped by feature
// Note: Model-related selectors removed - use React Query hooks (useSelectedModel, useModels, useSelectModel)
// selectCanSend deprecated - use local canSendLocal in components
export {
  conversationContext,
  HeimdallDataReset,
  selectBookmarkedMessages,
  selectConversationMessages,
  selectConversationState,
  selectCurrentConversationId,
  selectCurrentPath,
  selectDisplayMessages,
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
  selectProviderState,
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
  blobToDataURL,
  fetchConversationMessages,
  fetchMessageTree,
  initializeConversationData,
  initializeUserAndConversation,
  resolveAttachmentUrl,
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
