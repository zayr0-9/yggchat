import { createSelector } from '@reduxjs/toolkit'
import { ConversationId, ProjectId } from '../../../../../shared/types'
import { RootState } from '../../store/store'

const selectConvState = (state: RootState) => state.conversations

export const selectAllConversations = createSelector([selectConvState], state => state.items)
export const selectConvLoading = createSelector([selectConvState], state => state.loading)
export const selectConvError = createSelector([selectConvState], state => state.error)
export const selectActiveConversationId = createSelector([selectConvState], state => state.activeConversationId)

// Recent conversations selectors
export const selectRecentConversations = createSelector([selectConvState], state => state.recent.items)
export const selectRecentLoading = createSelector([selectConvState], state => state.recent.loading)
export const selectRecentError = createSelector([selectConvState], state => state.recent.error)

// Recent models selectors
export const selectRecentModels = createSelector([selectConvState], state => state.recentModels.items)
export const selectRecentModelsLoading = createSelector([selectConvState], state => state.recentModels.loading)
export const selectRecentModelsError = createSelector([selectConvState], state => state.recentModels.error)

// Selector to get a conversation by id
export const makeSelectConversationById = (id: ConversationId) =>
  createSelector([selectAllConversations], conversations => conversations.find(c => c.id === id))

// Selector to get conversations grouped by project_id
export const selectConversationsByProject = createSelector([selectAllConversations], conversations => {
  const grouped = new Map<ProjectId | null, { latestConversation: string; conversations: typeof conversations }>()

  conversations.forEach(conv => {
    const projectId = conv.project_id
    const existing = grouped.get(projectId)

    if (!existing) {
      grouped.set(projectId, {
        latestConversation: conv.updated_at,
        conversations: [conv],
      })
    } else {
      existing.conversations.push(conv)
      // Keep track of the latest updated_at time
      if (conv.updated_at > existing.latestConversation) {
        existing.latestConversation = conv.updated_at
      }
    }
  })

  return grouped
})
