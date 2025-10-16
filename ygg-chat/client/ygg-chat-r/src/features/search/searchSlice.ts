// searchSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { performProjectSearch, performSearch } from './searchActions'
import { SearchHistoryItem, SearchState } from './searchTypes'

const initialState: SearchState = {
  query: '',
  results: [],
  history: [],
  loading: false,
  error: null,
  focusedMessageId: null,
  focusedConversationId: null,
}

export const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    queryChanged: (state, action: PayloadAction<string>) => {
      state.query = action.payload
    },
    clearResults: state => {
      state.results = []
      state.error = null
    },
    focusSet: (state, action: PayloadAction<{ conversationId: string; messageId: string } | null>) => {
      state.focusedConversationId = action.payload?.conversationId ?? null
      state.focusedMessageId = action.payload?.messageId ?? null
    },
  },
  extraReducers: builder => {
    builder
      .addCase(performSearch.pending, state => {
        state.loading = true
        state.error = null
      })
      .addCase(performSearch.fulfilled, (state, action) => {
        state.loading = false
        state.results = action.payload
        state.error = null

        // Add to history
        if (state.query.trim()) {
          const historyItem: SearchHistoryItem = {
            id: Date.now().toString(),
            query: state.query,
            timestamp: Date.now(),
          }
          // Keep latest 20 items, unique by query
          state.history = [historyItem, ...state.history.filter(h => h.query !== historyItem.query)].slice(0, 20)
        }
      })
      .addCase(performSearch.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || 'Search failed'
      })
      .addCase(performProjectSearch.pending, state => {
        state.loading = true
        state.error = null
      })
      .addCase(performProjectSearch.fulfilled, (state, action) => {
        state.loading = false
        state.results = action.payload
        state.error = null

        // Add to history
        if (state.query.trim()) {
          const historyItem: SearchHistoryItem = {
            id: Date.now().toString(),
            query: state.query,
            timestamp: Date.now(),
          }
          // Keep latest 20 items, unique by query
          state.history = [historyItem, ...state.history.filter(h => h.query !== historyItem.query)].slice(0, 20)
        }
      })
      .addCase(performProjectSearch.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload || 'Search failed'
      })
  },
})

export const searchActions = { ...searchSlice.actions, performSearch, performProjectSearch }

export default searchSlice.reducer
