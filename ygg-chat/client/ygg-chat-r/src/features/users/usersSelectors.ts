// features/users/usersSelectors.ts
import { createSelector } from '@reduxjs/toolkit'
import type { UserState } from './usersTypes'

// Local RootState interface - only defines what this selector file needs
interface RootState {
  users: UserState
}

const selectUsersState = (state: RootState) => state.users

export const selectCurrentUser = createSelector([selectUsersState], state => state?.currentUser)

export const selectUserLoading = createSelector([selectUsersState], state => state?.loading || false)

export const selectUserError = createSelector([selectUsersState], state => state?.error)

export const selectIsAuthenticated = createSelector([selectUsersState], state => !!state?.currentUser)

export const selectUserId = createSelector([selectUsersState], state => state?.currentUser?.id)

export const selectUsername = createSelector([selectUsersState], state => state?.currentUser?.username)

export const selectUserStatus = createSelector([selectUsersState], state => ({
  loading: state?.loading || false,
  error: state?.error || null,
  isAuthenticated: !!state?.currentUser, //just checks if currentUser exists
}))
