// Helper functions for localStorage
import { User } from '../features/users/usersTypes'

const USER_STORAGE_KEY = 'yggdrasil_user'

export const saveUserToStorage = (user: User) => {
  try {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
  } catch (error) {
    console.error('Failed to save user to localStorage:', error)
  }
}

export const loadUserFromStorage = (): User | null => {
  try {
    const stored = localStorage.getItem(USER_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch (error) {
    console.error('Failed to load user from localStorage:', error)
    return null
  }
}

export const removeUserFromStorage = () => {
  try {
    localStorage.removeItem(USER_STORAGE_KEY)
  } catch (error) {
    console.error('Failed to remove user from localStorage:', error)
  }
}
