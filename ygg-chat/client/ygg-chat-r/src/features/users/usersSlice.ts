// features/users/usersSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { userInitialState } from '../initialStates'
import { deleteUser, loginUser } from './usersActions'
import { User, UserState } from './usersTypes'
// LocalStorage keys

const initialState: UserState = userInitialState

// Initial state
// const initialState: UserState = {
//   currentUser: loadUserFromStorage(),
//   loading: false,
//   error: null,
// }

// Slice
const usersSlice = createSlice({
  name: 'users',
  initialState,
  reducers: {
    clearUser: state => {
      state.currentUser = null
      state.error = null
      //   removeUserFromStorage()
    },
    clearError: state => {
      state.error = null
    },
    setUser: (state, action: PayloadAction<User>) => {
      state.currentUser = action.payload
      state.error = null
      //   saveUserToStorage(action.payload)
    },
  },
  extraReducers: builder => {
    builder
      // loginUser
      .addCase(loginUser.pending, state => {
        state.loading = true
        state.error = null
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.loading = false
        state.currentUser = action.payload
        state.error = null
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload as string
      })
      .addCase(deleteUser.fulfilled, state => {
        state.currentUser = null
        state.error = null
      })
  },
})

export const { clearUser, clearError, setUser } = usersSlice.actions
export default usersSlice.reducer
