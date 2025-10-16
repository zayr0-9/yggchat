import type { QueryClient } from '@tanstack/react-query'

// Store extra argument type for thunks - provides auth context and queryClient to all Redux actions
export interface ThunkExtraArgument {
  auth: {
    accessToken: string | null
    userId: string | null
  }
  queryClient: QueryClient | null
}

// This will be populated by the store middleware with current auth state and queryClient
export let thunkExtraArg: ThunkExtraArgument = {
  auth: {
    accessToken: null,
    userId: null,
  },
  queryClient: null,
}

// Function to update the thunk extra argument with current auth state
export const updateThunkExtraAuth = (accessToken: string | null, userId: string | null) => {
  thunkExtraArg.auth.accessToken = accessToken
  thunkExtraArg.auth.userId = userId
}

// Function to update the thunk extra argument with queryClient instance
export const updateThunkExtraQueryClient = (queryClient: QueryClient) => {
  thunkExtraArg.queryClient = queryClient
}
