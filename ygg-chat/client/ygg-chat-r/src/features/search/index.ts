// index.ts - search feature public API
export { default as searchReducer, searchActions } from './searchSlice'
export type { SearchState, SearchResult, SearchHistoryItem } from './searchTypes'
export {
  selectSearchState,
  selectSearchQuery,
  selectSearchResults,
  selectSearchLoading,
  selectSearchError,
  selectSearchHistory,
  selectFocusedMessage,
} from './searchSelectors'
