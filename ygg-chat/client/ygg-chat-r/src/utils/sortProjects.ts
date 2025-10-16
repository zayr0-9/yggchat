import { ProjectWithLatestConversation } from '../../../../shared/types'

/**
 * Sorts projects by the specified criteria with optional inversion
 * @param projects - Array of projects to sort
 * @param sortBy - Sort criteria: 'updated' | 'created' | 'name'
 * @param invert - Whether to reverse the sort order (default: false)
 * @returns Sorted array of projects
 */
export const sortProjects = (
  projects: ProjectWithLatestConversation[],
  sortBy: 'updated' | 'created' | 'name',
  invert: boolean = false
): ProjectWithLatestConversation[] => {
  const sorted = [...projects].sort((a, b) => {
    switch (sortBy) {
      case 'updated':
        // Use server-provided latest_conversation_updated_at (already sorted by server DESC)
        // This eliminates the race condition with conversations loading
        const aDate = a.latest_conversation_updated_at || a.updated_at || a.created_at || ''
        const bDate = b.latest_conversation_updated_at || b.updated_at || b.created_at || ''

        if (!aDate) return 1
        if (!bDate) return -1

        const dateCompare = bDate.localeCompare(aDate)
        // Add stable secondary sort by created_at when dates are equal
        if (dateCompare === 0) {
          const aCreated = a.created_at || ''
          const bCreated = b.created_at || ''
          return bCreated.localeCompare(aCreated)
        }
        return dateCompare

      case 'created':
        if (!a.created_at) return 1
        if (!b.created_at) return -1

        const createdCompare = b.created_at.localeCompare(a.created_at)
        // Add stable secondary sort by name when created dates are equal
        if (createdCompare === 0) {
          return a.name.localeCompare(b.name)
        }
        return createdCompare

      case 'name':
        return a.name.localeCompare(b.name)

      default:
        return 0
    }
  })

  return invert ? sorted.reverse() : sorted
}
