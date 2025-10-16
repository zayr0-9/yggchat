// store.ts
import { configureStore } from '@reduxjs/toolkit'
import { chatReducer } from '../features/chats'
import { conversationsReducer } from '../features/conversations'
import { ideContextReducer } from '../features/ideContext'
import { default as projectsReducer } from '../features/projects/projectSlice'
import { default as searchReducer } from '../features/search/searchSlice'
import { usersReducer } from '../features/users'
import { thunkExtraArg } from './thunkExtra'

// Root reducer configuration
const rootReducer = {
  users: usersReducer,
  chat: chatReducer,
  conversations: conversationsReducer,
  search: searchReducer,
  projects: projectsReducer,
  ideContext: ideContextReducer,
}

// Main store for the app
export const store = configureStore({
  reducer: rootReducer,
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      thunk: {
        extraArgument: thunkExtraArg,
      },
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
      },
    }),
  devTools: process.env.NODE_ENV !== 'production',
})

// Store factory for testing with preloaded state
export const setupStore = (preloadedState?: Partial<RootState>) => {
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({
        serializableCheck: {
          ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
        },
      }),
    devTools: process.env.NODE_ENV !== 'production',
  })
}

// Types
export type RootState = ReturnType<typeof store.getState>
export type AppStore = ReturnType<typeof setupStore>
export type AppDispatch = typeof store.dispatch
