// features/users/usersTypes.ts

export interface User {
  id: number
  username: string
  created_at: string
  favourite_conversations?: number[]
  credit_limit?: number
  credit_left?: number
}

export interface UserSettings {
  default_theme: 'light' | 'dark' | 'system'
  agent: boolean
}

export interface UserState {
  currentUser: User | null
  loading: boolean
  error: string | null //or could split into error Boolean and errorMessage
}

export interface LoginUserPayload {
  username: string
}
