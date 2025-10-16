// searchSelectors.ts
// Reusable memo-less selectors for the search feature

import type { RootState } from '../../store/store'
import type { SearchState } from './searchTypes'

const selectSearchSlice = (state: RootState) => state.search as SearchState

export const selectSearchState = (state: RootState) => selectSearchSlice(state)
export const selectSearchQuery = (state: RootState) => selectSearchSlice(state).query
export const selectSearchResults = (state: RootState) => selectSearchSlice(state).results
export const selectSearchLoading = (state: RootState) => selectSearchSlice(state).loading
export const selectSearchError = (state: RootState) => selectSearchSlice(state).error
export const selectSearchHistory = (state: RootState) => selectSearchSlice(state).history

export const selectFocusedMessage = (state: RootState) => ({
  conversationId: selectSearchSlice(state).focusedConversationId,
  messageId: selectSearchSlice(state).focusedMessageId,
})
