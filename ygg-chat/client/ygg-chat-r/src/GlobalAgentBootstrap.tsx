import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isCommunityMode } from './config/runtimeMode'
import { useAuth } from './hooks/useAuth'
import { globalAgentLoop } from './services'
import { useAppDispatch } from './hooks/redux'
import { useStore } from 'react-redux'
import type { RootState } from './store/store'

const GlobalAgentBootstrap = () => {
  const { userId, accessToken } = useAuth()
  const queryClient = useQueryClient()
  const dispatch = useAppDispatch()
  const store = useStore()

  // Inject queryClient into GlobalAgentLoop for React Query cache updates
  useEffect(() => {
    if (import.meta.env.VITE_ENVIRONMENT !== 'electron' || isCommunityMode) return

    globalAgentLoop.setQueryClient(queryClient)

    return () => {
      globalAgentLoop.setQueryClient(null)
    }
  }, [queryClient])

  // Inject Redux dispatch and getState for tool execution
  useEffect(() => {
    if (import.meta.env.VITE_ENVIRONMENT !== 'electron' || isCommunityMode) return

    globalAgentLoop.setReduxContext(dispatch, () => store.getState() as RootState)

    return () => {
      globalAgentLoop.setReduxContext(null, null)
    }
  }, [dispatch, store])

  // Initialize global agent
  useEffect(() => {
    if (import.meta.env.VITE_ENVIRONMENT !== 'electron' || isCommunityMode) return
    if (!userId) return

    globalAgentLoop.initialize(userId, accessToken).catch(error => {
      console.error('[GlobalAgentBootstrap] Failed to initialize global agent:', error)
    })
  }, [userId, accessToken])

  return null
}

export default GlobalAgentBootstrap
