// features/users/usersTypes.ts

export interface User {
  id: string
  username: string
  created_at: string
  favourite_conversations?: string[]
  credit_limit?: number
  credit_left?: number
  quick_chat_project_id?: string
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
