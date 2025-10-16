// import { ErrorResponse } from '@shared/types'
import { createAsyncThunk } from '@reduxjs/toolkit'
import { saveUserToStorage } from '../../helpers/storageHandler'
import { User } from './usersTypes'

// Async thunks
export const loginUser = createAsyncThunk<User, string>(
  'users/loginUser',
  async (username: string, { rejectWithValue }) => {
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
      })

      if (!response.ok) {
        const error = await response.json()
        return rejectWithValue(error.error || 'Failed to login')
      }

      const user = await response.json()
      saveUserToStorage(user)
      return user
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Network error')
    }
  }
)

export const deleteUser = createAsyncThunk<void, number>('users/deleteUser', async userId => {
  const response = await fetch(`/api/users/${userId}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Delete failed')
})

export { clearError, clearUser, setUser } from './usersSlice'
