import { useQueryClient } from '@tanstack/react-query'
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConversationId, Project } from '../../../../shared/types'
import { Button } from '../components'
import SearchList, { type SearchResultItem } from '../components/SearchList/SearchList'
import { chatSliceActions } from '../features/chats'
import {
  activeConversationIdSet,
  Conversation,
  createConversation,
  deleteConversation,
} from '../features/conversations'
import { deleteProject } from '../features/projects'
import { type ConversationTab } from '../helpers/sidebarPreferences'
// import { searchActions, selectSearchLoading, selectSearchQuery, selectSearchResults } from '../features/search'
import { useAppDispatch } from '../hooks/redux'
import { useAuth } from '../hooks/useAuth'
import {
  useConversationsByProject,
  useFavoritedConversations,
  useProjects,
  useSearchConversations,
} from '../hooks/useQueries'

type SidebarProject = Project & {
  latest_conversation_updated_at?: string | null
  description?: string
}

interface SideBarProps {
  limit?: number
  className?: string
  projects?: SidebarProject[]
  activeConversationId?: ConversationId | null
}

const LOCAL_MODE_RECENT_PROJECTS_LIMIT = 100

interface ProjectAccordionItemProps {
  project: SidebarProject
  isExpanded: boolean
  isCollapsed: boolean
  activeConversationId: ConversationId | null
  onToggle: (projectId: string) => void
  onSelectConversation: (conversation: Conversation) => void
  onCreateConversation: (project: SidebarProject) => void
  onDeleteProject: (project: SidebarProject) => void
  onDeleteConversation: (conversation: Conversation) => void
}

const ProjectAccordionItem: React.FC<ProjectAccordionItemProps> = ({
  project,
  isExpanded,
  isCollapsed,
  activeConversationId,
  onToggle,
  onSelectConversation,
  onCreateConversation,
  onDeleteProject,
  onDeleteConversation,
}) => {
  const {
    data: projectConversations = [],
    isLoading: projectConversationsLoading,
    error: projectConversationsError,
  } = useConversationsByProject(isExpanded ? project.id : null)

  const sortedConversations = useMemo(() => {
    return [...projectConversations].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }, [projectConversations])

  const projectLastActivityDate =
    project.latest_conversation_updated_at || project.updated_at || project.created_at || null

  return (
    <div className='sm:mb-1 md:mb-1 lg:mb-1.5 2xl:mb-2 group relative overflow-hidden'>
      {isCollapsed ? (
        <div
          role='button'
          tabIndex={0}
          onClick={() => onToggle(project.id)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onToggle(project.id)
            }
          }}
          className='w-full text-left rounded-lg transition-all duration-200 cursor-pointer py-2 flex items-center hover:scale-90 justify-center'
          title={project.name}
        >
          <Button
            variant='outline2'
            size='circle'
            rounded='full'
            className='h-10 w-10 text-md font-semibold text-lg md:text-base lg:text-sm xl:text-sm 2xl:text-lg'
          >
            {project.name ? project.name.charAt(0).toUpperCase() : '#'}
          </Button>
        </div>
      ) : (
        <div className='rounded-lg hover:bg-stone-100/30 dark:hover:bg-yBlack-900/10 transition-all duration-200'>
          <div className='flex items-start justify-between px-2 py-2 gap-2 min-w-0'>
            <button
              type='button'
              onClick={() => onToggle(project.id)}
              className='flex items-start gap-2 min-w-0 flex-1 text-left'
              aria-expanded={isExpanded}
            >
              <i
                className={`bx ${isExpanded ? 'bx-chevron-down' : 'bx-chevron-right'} text-neutral-500 text-lg mt-0.5`}
                aria-hidden='true'
              ></i>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-1 min-w-0'>
                  <div className='text-[12px] md:text-[12px] lg:text-[13px] xl:text-[13px] 2xl:text-[14px] font-medium text-neutral-900 dark:text-stone-200 truncate min-w-0 flex-1'>
                    {project.name}
                  </div>
                  {project.storage_mode !== 'local' && (
                    <i
                      className='bx bx-cloud text-[14px] text-blue-500 shrink-0'
                      aria-label='Cloud project'
                      title='Cloud project'
                    ></i>
                  )}
                </div>
                {projectLastActivityDate && (
                  <div className='text-[10px] text-neutral-500 dark:text-neutral-400'>
                    {new Date(projectLastActivityDate).toLocaleDateString()}
                  </div>
                )}
              </div>
            </button>
            <div className='flex items-center gap-1 shrink-0'>
              <Button
                variant='outline2'
                size='smaller'
                rounded='full'
                className='mt-0.5 px-2 py-1 shrink-0'
                onClick={() => onCreateConversation(project)}
                title='New chat in project'
                aria-label={`Create new chat in ${project.name}`}
              >
                <i className='bx bx-plus text-lg' aria-hidden='true'></i>
              </Button>
              <Button
                variant='outline2'
                size='smaller'
                rounded='full'
                className='mt-0.5 px-2 py-1 text-red-500 dark:text-red-400 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto transition-opacity duration-150'
                onClick={() => onDeleteProject(project)}
                title='Delete project'
                aria-label={`Delete project ${project.name}`}
              >
                <i className='bx bx-trash text-lg' aria-hidden='true'></i>
              </Button>
            </div>
          </div>

          {isExpanded && (
            <div className='pb-2 pr-2 pl-8'>
              {projectConversationsLoading && (
                <div className='text-xs text-neutral-500 dark:text-neutral-400 py-1'>Loading chats...</div>
              )}
              {projectConversationsError && (
                <div className='text-xs text-red-500 dark:text-red-400 py-1'>Failed to load chats</div>
              )}
              {!projectConversationsLoading && !projectConversationsError && sortedConversations.length === 0 && (
                <div className='text-xs text-neutral-500 dark:text-neutral-400 py-1'>No chats yet</div>
              )}
              {!projectConversationsLoading &&
                !projectConversationsError &&
                sortedConversations.map(conversation => {
                  const isActive = String(activeConversationId) === String(conversation.id)
                  return (
                    <div
                      key={conversation.id}
                      className='group/conv flex items-start gap-1 mb-1 min-w-0 overflow-hidden'
                    >
                      <button
                        type='button'
                        onClick={() => onSelectConversation(conversation)}
                        className={`w-full min-w-0 overflow-hidden text-left rounded-md px-2 py-1.5 text-xs md:text-[11px] lg:text-[12px] transition-colors ${
                          isActive
                            ? 'bg-blue-100 dark:bg-neutral-500/40 text-blue-700 dark:text-orange-300'
                            : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/70'
                        }`}
                      >
                        <div className='min-w-0'>
                          <div className='truncate'>{conversation.title || 'Untitled conversation'}</div>
                          {conversation.updated_at && (
                            <div className='text-[10px] text-neutral-500 dark:text-neutral-400 mt-0.5 truncate'>
                              {new Date(conversation.updated_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      </button>
                      <Button
                        variant='outline2'
                        size='smaller'
                        rounded='full'
                        className='mt-0.5 px-2 py-1 shrink-0 text-red-500 dark:text-red-400 opacity-0 pointer-events-none group-hover/conv:opacity-100 group-hover/conv:pointer-events-auto group-focus-within/conv:opacity-100 group-focus-within/conv:pointer-events-auto transition-opacity duration-150'
                        onClick={() => onDeleteConversation(conversation)}
                        title='Delete conversation'
                        aria-label={`Delete conversation ${conversation.title || conversation.id}`}
                      >
                        <i className='bx bx-trash text-lg' aria-hidden='true'></i>
                      </Button>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {isCollapsed && (
        <div className='absolute left-full ml-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50'>
          <div className='bg-neutral-900 dark:bg-neutral-700 text-white dark:text-neutral-100 px-3 py-2 rounded-lg shadow-lg text-sm whitespace-nowrap max-w-xs'>
            <div className='font-medium flex items-center gap-1'>
              <span>{project.name}</span>
              {project.storage_mode !== 'local' && (
                <i className='bx bx-cloud text-[14px] text-blue-300' title='Cloud project'></i>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SideBar: React.FC<SideBarProps> = ({
  limit = 100,
  className = '',
  projects = [],
  activeConversationId = null,
}) => {
  const dispatch = useAppDispatch()
  const { userId } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const isWeb = import.meta.env.VITE_ENVIRONMENT === 'web'

  const [conversationTab, setConversationTab] = useState<ConversationTab>('recent')
  // NOTE: 'recent' tab is repurposed as the Projects tab across the app.
  const isProjectsTab = conversationTab !== 'favorites'

  // Track expanded projects in chat sidebar (lazy-load conversations per project)
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])

  // Fetch projects using React Query
  const { data: fetchedProjects = [], isLoading: projectsLoading, error: projectsError } = useProjects()
  const projectData = projects.length > 0 ? projects : fetchedProjects

  const visibleProjects = useMemo(() => {
    if (isWeb) return projectData

    let localProjectsShown = 0
    return projectData.filter(project => {
      if (project.storage_mode !== 'local') return true
      localProjectsShown += 1
      return localProjectsShown <= LOCAL_MODE_RECENT_PROJECTS_LIMIT
    })
  }, [projectData, isWeb])

  // Default expand only the latest visible project. Keep user-expanded projects if still visible.
  useEffect(() => {
    setExpandedProjectIds(prevExpanded => {
      const visibleIds = new Set(visibleProjects.map(project => String(project.id)))
      const preserved = prevExpanded.filter(id => visibleIds.has(String(id)))
      if (preserved.length > 0) return preserved
      if (visibleProjects.length === 0) return []
      return [String(visibleProjects[0].id)]
    })
  }, [visibleProjects])

  // Keep favorites tab available across all routes
  const {
    data: favoriteConversations = [],
    isLoading: favoritesLoading,
    error: favoritesError,
  } = useFavoritedConversations(limit)

  const loading = isProjectsTab ? projectsLoading : favoritesLoading
  const error = isProjectsTab
    ? projectsError
      ? String(projectsError)
      : null
    : favoritesError
      ? String(favoritesError)
      : null

  const [searchQuery, setSearchQuery] = useState('')
  const {
    search,
    clearSearch,
    searchResults: searchedConversations,
    isSearching,
  } = useSearchConversations(null, { forceServerSearch: true })

  const sidebarSearchResults = useMemo<SearchResultItem[]>(() => {
    return searchedConversations.map(conversation => {
      const projectName = conversation.project_id
        ? projectData.find(p => String(p.id) === String(conversation.project_id))?.name
        : null
      return {
        conversationId: conversation.id,
        messageId: String(conversation.id),
        content: projectName ? `Project: ${projectName}` : 'Project: None',
        conversationTitle: conversation.title || 'Untitled conversation',
        createdAt: conversation.updated_at || conversation.created_at || new Date().toISOString(),
      }
    })
  }, [searchedConversations, projectData])

  // Drawer collapse state with localStorage persistence and mobile-first default
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return false

      const stored = localStorage.getItem('sidebar:collapsed')

      // If user has a stored preference, use it
      if (stored !== null) {
        return stored === 'true'
      }

      // Otherwise, default to collapsed on mobile, expanded on desktop
      // Use window.innerWidth for initial state since hook isn't available in initializer
      return window.innerWidth < 768
    } catch {
      return false
    }
  })

  // Theme state
  const [themeMode, setThemeMode] = useState<'Light' | 'Dark' | 'System'>(() => {
    if (typeof window === 'undefined') return 'Light'
    const saved = localStorage.getItem('theme')
    return saved === 'dark' ? 'Dark' : saved === 'light' ? 'Light' : saved === 'system' ? 'System' : 'System'
  })

  // Persist collapse state
  useEffect(() => {
    try {
      localStorage.setItem('sidebar:collapsed', String(isCollapsed))
    } catch (storageError) {
      console.warn('Failed to persist sidebar collapse state:', storageError)
    }
  }, [isCollapsed])

  // Apply theme immediately when user toggles preference
  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const isDark = themeMode === 'Dark' || (themeMode === 'System' && media.matches)
    document.documentElement.classList.toggle('dark', isDark)

    // Notify Electron to update title bar colors
    if (window.electronAPI?.theme?.update) {
      window.electronAPI.theme.update(isDark)
    }
  }, [themeMode])

  // Persist theme preference
  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem('theme', themeMode === 'Dark' ? 'dark' : themeMode === 'Light' ? 'light' : 'system')
  }, [themeMode])

  const cycleTheme = () => {
    setThemeMode(prev => (prev === 'Light' ? 'Dark' : prev === 'Dark' ? 'System' : 'Light'))
  }

  useEffect(() => {
    if (!isProjectsTab && searchQuery) {
      setSearchQuery('')
      clearSearch()
    }
  }, [isProjectsTab, searchQuery, clearSearch])

  const handleSearchChange = (value: string) => {
    setSearchQuery(value)
    if (!value.trim()) {
      clearSearch()
    }
  }

  const handleSearchSubmit = () => {
    const trimmedQuery = searchQuery.trim()
    if (!trimmedQuery) {
      clearSearch()
      return
    }

    search(trimmedQuery)
  }

  const handleSearchResultClick = (conversationId: ConversationId) => {
    const match = searchedConversations.find(conversation => String(conversation.id) === String(conversationId))
    if (!match) return

    handleProjectConversationSelect(match)
    setSearchQuery('')
    clearSearch()
  }

  const handleSelect = (id: ConversationId) => {
    const conversation = favoriteConversations.find(c => c.id === id)
    dispatch(chatSliceActions.conversationSet(id))
    dispatch(activeConversationIdSet(id))
    navigate(`/chat/${conversation?.project_id || 'unknown'}/${id}`)
  }

  const handleProjectConversationSelect = (conversation: Conversation) => {
    dispatch(chatSliceActions.conversationSet(conversation.id))
    dispatch(activeConversationIdSet(conversation.id))
    navigate(`/chat/${conversation.project_id || 'unknown'}/${conversation.id}`, {
      state: conversation.storage_mode ? { storageMode: conversation.storage_mode } : undefined,
    })
  }

  const handleToggleProjectExpansion = (projectId: string) => {
    const normalizedProjectId = String(projectId)

    if (isCollapsed) {
      setIsCollapsed(false)
      setExpandedProjectIds(prev => (prev.includes(normalizedProjectId) ? prev : [normalizedProjectId, ...prev]))
      return
    }

    setExpandedProjectIds(prev =>
      prev.includes(normalizedProjectId)
        ? prev.filter(id => id !== normalizedProjectId)
        : [...prev, normalizedProjectId]
    )
  }

  const handleDeleteSidebarProject = async (project: SidebarProject) => {
    const shouldDelete = window.confirm(`Delete project "${project.name}"? This action cannot be undone.`)
    if (!shouldDelete) return

    try {
      await dispatch(deleteProject({ id: project.id, storageMode: project.storage_mode })).unwrap()

      setExpandedProjectIds(prev => prev.filter(id => String(id) !== String(project.id)))

      if (userId) {
        queryClient.setQueryData<SidebarProject[]>(['projects', userId], previous =>
          previous ? previous.filter(item => String(item.id) !== String(project.id)) : previous
        )
      }

      queryClient.setQueryData<Conversation[]>(['conversations'], previous =>
        previous ? previous.filter(item => String(item.project_id) !== String(project.id)) : previous
      )
      queryClient.setQueriesData<Conversation[]>({ queryKey: ['conversations', 'recent'] }, previous =>
        previous ? previous.filter(item => String(item.project_id) !== String(project.id)) : previous
      )
      queryClient.removeQueries({ queryKey: ['conversations', 'project', project.id] })

      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (deleteError) {
      console.error('Failed to delete project from sidebar:', deleteError)
    }
  }

  const handleDeleteSidebarConversation = async (conversation: Conversation) => {
    const label = conversation.title || `Conversation ${conversation.id}`
    const shouldDelete = window.confirm(`Delete conversation "${label}"? This action cannot be undone.`)
    if (!shouldDelete) return

    try {
      await dispatch(
        deleteConversation({ id: conversation.id, storageMode: conversation.storage_mode || 'cloud' })
      ).unwrap()

      queryClient.setQueryData<Conversation[]>(['conversations', 'project', conversation.project_id], previous =>
        previous ? previous.filter(item => String(item.id) !== String(conversation.id)) : previous
      )
      queryClient.setQueryData<Conversation[]>(['conversations'], previous =>
        previous ? previous.filter(item => String(item.id) !== String(conversation.id)) : previous
      )
      queryClient.setQueriesData<Conversation[]>({ queryKey: ['conversations', 'recent'] }, previous =>
        previous ? previous.filter(item => String(item.id) !== String(conversation.id)) : previous
      )
      queryClient.setQueriesData<Conversation[]>({ queryKey: ['conversations', 'favorites'] }, previous =>
        previous ? previous.filter(item => String(item.id) !== String(conversation.id)) : previous
      )

      if (String(activeConversationId) === String(conversation.id)) {
        if (conversation.project_id) {
          navigate(`/conversationPage?projectId=${conversation.project_id}`)
        } else {
          navigate('/conversationPage')
        }
      }

      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    } catch (deleteError) {
      console.error('Failed to delete conversation from sidebar:', deleteError)
    }
  }

  const handleCreateConversationForProject = async (project: SidebarProject) => {
    try {
      const createdConversation = await dispatch(
        createConversation({
          projectId: project.id,
          title: `${project.name} Conversation`,
          storageMode: project.storage_mode || 'cloud',
        })
      ).unwrap()

      setExpandedProjectIds(prev => (prev.includes(project.id) ? prev : [project.id, ...prev]))

      queryClient.setQueryData<Conversation[]>(['conversations', 'project', project.id], previous => {
        const previousItems = previous || []
        return [createdConversation, ...previousItems.filter(item => item.id !== createdConversation.id)]
      })

      queryClient.setQueryData<Conversation[]>(['conversations'], previous => {
        const previousItems = previous || []
        return [createdConversation, ...previousItems.filter(item => item.id !== createdConversation.id)]
      })

      queryClient.setQueriesData<Conversation[]>({ queryKey: ['conversations', 'recent'] }, previous => {
        const previousItems = previous || []
        return [createdConversation, ...previousItems.filter(item => item.id !== createdConversation.id)]
      })

      const activityTimestamp =
        createdConversation.updated_at || createdConversation.created_at || new Date().toISOString()
      const debugProjectOrder =
        typeof window !== 'undefined' && window.localStorage.getItem('sidebar:debugProjectOrder') === 'true'
      const previousProjectOrder = userId
        ? queryClient.getQueryData<SidebarProject[]>(['projects', userId])?.map(item => item.id)
        : undefined

      const applyProjectActivityOrdering = (previousProjects?: SidebarProject[]) => {
        if (!previousProjects || previousProjects.length === 0) return previousProjects

        const updatedProjects = previousProjects.map(existingProject => {
          if (String(existingProject.id) !== String(project.id)) return existingProject

          return {
            ...existingProject,
            updated_at: activityTimestamp,
            latest_conversation_updated_at: activityTimestamp,
          }
        })

        updatedProjects.sort((a, b) => {
          const getSortTime = (item: SidebarProject) => {
            const candidate = item.latest_conversation_updated_at || item.updated_at || item.created_at
            return candidate ? new Date(candidate).getTime() : 0
          }
          return getSortTime(b) - getSortTime(a)
        })

        return updatedProjects
      }

      if (userId) {
        queryClient.setQueryData<SidebarProject[]>(['projects', userId], applyProjectActivityOrdering)

        if (debugProjectOrder) {
          const nextProjectOrder = queryClient
            .getQueryData<SidebarProject[]>(['projects', userId])
            ?.map(item => item.id)
          console.debug('[SideBar] project order after creating conversation', {
            projectId: project.id,
            conversationId: createdConversation.id,
            previousProjectOrder,
            nextProjectOrder,
          })
        }
      }

      // Mark projects stale, but do not immediately refetch active queries.
      // Immediate refetch can return slightly stale ordering from backend and cause
      // the just-promoted project row to "jump" back down momentarily.
      queryClient.invalidateQueries({ queryKey: ['projects'], refetchType: 'none' })

      dispatch(chatSliceActions.conversationSet(createdConversation.id))
      dispatch(activeConversationIdSet(createdConversation.id))
      navigate(`/chat/${createdConversation.project_id || project.id}/${createdConversation.id}`, {
        state: {
          storageMode: createdConversation.storage_mode || project.storage_mode || 'cloud',
        },
      })
    } catch (createError) {
      console.error('Failed to create conversation from sidebar:', createError)
    }
  }

  const toggleCollapse = () => {
    setIsCollapsed(prev => !prev)
  }

  return (
    <aside
      className={`relative z-10 ${isWeb ? 'h-[100vh]' : 'h-full'}  shadow-md flex flex-col rounded-tr-xl transition-all duration-300 ease-in-out backdrop-blur-sm bg-neutral-100/70 dark:bg-transparent flex-shrink-0 overflow-x-hidden ${isCollapsed ? 'w-15 ' : 'w-64 md:w-64 lg:w-70 xl:w-80 '} ${className}`}
      aria-label={isProjectsTab ? 'Projects and conversations' : 'Favorite conversations'}
    >
      {/* Toggle Button */}
      <div className='flex items-center justify-between py-3 my-1 md:py-2.5 lg:p-1 xl:p-1 2xl:px-1 2xl:py-2'>
        {!isCollapsed && (
          <h2 className='text-[14px] md:text-[16px] lg:text-[16px] xl:text-[16px] 2xl:text-[18px] 3xl:text-[20px] 4xl:text-[22px] pl-2 font-semibold text-neutral-700 dark:text-neutral-200 truncate'>
            {isProjectsTab ? 'Projects' : 'Favorites'}
          </h2>
        )}
        <Button
          variant='outline2'
          size='circle'
          rounded='full'
          onClick={toggleCollapse}
          className={`${isCollapsed ? 'mx-auto' : ' mr-2'} transition-transform duration-200 hover:scale-103 p-3`}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`bx ${isCollapsed ? 'bx-chevron-right' : 'bx-chevron-left'} text-lg `} aria-hidden='true'></i>
        </Button>
      </div>

      {!isCollapsed && (
        <div className='px-2 pb-2'>
          <div className='flex items-center gap-1 rounded-md bg-neutral-200/60 dark:bg-neutral-800/60 p-1'>
            <button
              type='button'
              onClick={() => setConversationTab('recent')}
              className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                conversationTab === 'recent'
                  ? 'bg-white/80 text-neutral-900 shadow-sm dark:bg-neutral-700/65 dark:text-neutral-100'
                  : 'text-neutral-600 hover:bg-white/40 dark:text-neutral-300 dark:hover:bg-neutral-700/60'
              }`}
            >
              Projects
            </button>
            <button
              type='button'
              onClick={() => setConversationTab('favorites')}
              className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                conversationTab === 'favorites'
                  ? 'bg-white/80 text-neutral-900 shadow-sm dark:bg-neutral-700/65 dark:text-neutral-100'
                  : 'text-neutral-600 hover:bg-white/40 dark:text-neutral-300 dark:hover:bg-neutral-700/60'
              }`}
            >
              Favorites
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      {!isCollapsed && isProjectsTab && (
        <div className='px-2 pb-2 relative z-50'>
          <SearchList
            value={searchQuery}
            onChange={handleSearchChange}
            onSubmit={handleSearchSubmit}
            results={sidebarSearchResults}
            loading={isSearching}
            onResultClick={conversationId => handleSearchResultClick(conversationId)}
            placeholder='Search chat...'
            dropdownVariant='neutral'
          />
        </div>
      )}

      {/* Conversations List */}
      <div className='flex-1 overflow-y-auto overflow-x-hidden p-2 pt-2 2xl:pt-2 no-scrollbar scroll-fade dark:border-neutral-800 rounded-xl border-t-0'>
        {loading && (
          <div
            className={`text-xs text-gray-500 dark:text-gray-300 px-2 py-1 ${isCollapsed ? 'text-center' : ''}`}
            title={isCollapsed ? 'Loading...' : undefined}
          >
            {isCollapsed ? '...' : 'Loading...'}
          </div>
        )}
        {error && (
          <div
            className={`text-xs text-red-600 dark:text-red-400 px-2 py-1 ${isCollapsed ? 'text-center' : ''}`}
            role='alert'
            title={isCollapsed ? error : undefined}
          >
            {isCollapsed ? '!' : error}
          </div>
        )}
        {isProjectsTab ? (
          <>
            {visibleProjects.map(project => (
              <ProjectAccordionItem
                key={project.id}
                project={project}
                isExpanded={expandedProjectIds.includes(String(project.id))}
                isCollapsed={isCollapsed}
                activeConversationId={activeConversationId}
                onToggle={handleToggleProjectExpansion}
                onSelectConversation={handleProjectConversationSelect}
                onCreateConversation={handleCreateConversationForProject}
                onDeleteProject={handleDeleteSidebarProject}
                onDeleteConversation={handleDeleteSidebarConversation}
              />
            ))}
            {visibleProjects.length === 0 && !loading && !error && (
              <div
                className={`text-xs text-neutral-500 dark:text-neutral-400 px-2 py-1 ${isCollapsed ? 'hidden' : ''}`}
              >
                No projects
              </div>
            )}
          </>
        ) : (
          // Recent Conversations List
          <>
            {favoriteConversations.map(conv => {
              const isActive = activeConversationId === conv.id
              const projectName = conv.project_id ? projectData.find(p => p.id === conv.project_id)?.name : undefined

              return (
                <div key={conv.id} className='sm:mb-1 md:mb-1 lg:mb-1.5 2xl:mb-2 group relative'>
                  <div
                    role='button'
                    tabIndex={0}
                    onClick={() => handleSelect(conv.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSelect(conv.id)
                      }
                    }}
                    className={`w-full text-left rounded-lg transition-all duration-200 cursor-pointer ${
                      isCollapsed
                        ? 'py-2 flex items-center hover:scale-90 justify-center'
                        : 'hover:bg-stone-100/30 hover:ring-neutral-100 hover:ring-1 sm:py-1 xl:py-2 dark:hover:ring-neutral-600/60 outline-transparent dark:hover:bg-yBlack-900/10'
                    } ${isActive ? 'bg-indigo-100 dark:bg-indigo-900/40 border-l-4 border-indigo-500' : ''}`}
                    title={isCollapsed ? conv.title || `Conversation ${conv.id}` : undefined}
                  >
                    {isCollapsed ? (
                      <Button
                        variant='outline2'
                        size='circle'
                        rounded='full'
                        className='h-10 w-10 text-md font-semibold text-lg md:text-base lg:text-sm xl:text-sm 2xl:text-lg'
                      >
                        {conv.title ? conv.title.charAt(0).toUpperCase() : '#'}
                      </Button>
                    ) : (
                      <div className='flex flex-col gap-0 md:gap-1 lg:gap-1.5 xl:gap-1 2xl:gap-2 py-2 md:py-0 lg:py-0 xl:py-0 mx-2'>
                        <span className='text-[10px] md:text-[11px] lg:text-[12px] xl:text-[12px] 2xl:text-[14px] 3xl:text-[16px] 4xl:text-[14px] font-medium text-neutral-900 dark:text-stone-200 truncate'>
                          {conv.title || `Conversation ${conv.id}`}
                        </span>
                        {projectName && (
                          <span className='text-xs md:text-[11px] lg:text-[10px] xl:text-[12px] 2xl:text-[12px] 3xl:text-[16px] 4xl:text-[14px] text-neutral-600 dark:text-stone-300 truncate'>
                            Project: {projectName}
                          </span>
                        )}
                        {conv.updated_at && (
                          <span className='text-xs md:text-[11px] lg:text-[10px] xl:text-[9px] 2xl:text-[11px] 3xl:text-[12px] 4xl:text-[14px] text-neutral-500 dark:text-neutral-400 text-right'>
                            {new Date(conv.updated_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Tooltip for collapsed state */}
                  {isCollapsed && (
                    <div className='absolute left-full ml-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50'>
                      <div className='bg-neutral-900 dark:bg-neutral-700 text-white dark:text-neutral-100 px-3 py-2 rounded-lg shadow-lg text-sm whitespace-nowrap max-w-xs'>
                        <div className='font-medium'>{conv.title || `Conversation ${conv.id}`}</div>
                        {projectName && <div className='text-xs opacity-80 mt-1'>Project: {projectName}</div>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {favoriteConversations.length === 0 && !loading && !error && (
              <div
                className={`text-xs text-neutral-500 dark:text-neutral-400 px-2 py-1 ${isCollapsed ? 'hidden' : ''}`}
              >
                No favorite conversations
              </div>
            )}
          </>
        )}
      </div>
      <div className='border-t border-neutral-200/70 px-1 py-2 dark:border-neutral-800/70'>
        {[
          {
            key: 'theme',
            label: themeMode,
            iconClass: themeMode === 'System' ? 'bx-desktop' : themeMode === 'Dark' ? 'bx-moon' : 'bx-sun',
            onClick: cycleTheme,
            title: `Theme: ${themeMode} (click to change)`,
            ariaLabel: `Theme: ${themeMode}`,
          },
          {
            key: 'logging',
            label: 'Logging',
            iconClass: 'bx-line-chart',
            onClick: () => navigate('/logging'),
            title: 'Open logging',
            ariaLabel: 'Open logging',
          },
          {
            key: 'profile',
            label: 'Profile',
            iconClass: 'bx-user-circle',
            onClick: () => navigate('/payment'),
            title: 'Open profile',
            ariaLabel: 'Open profile',
          },
          {
            key: 'settings',
            label: 'Settings',
            iconClass: 'bx-cog',
            onClick: () => navigate('/settings'),
            title: 'Open settings',
            ariaLabel: 'Open settings',
          },
        ].map(action => (
          <button
            key={action.key}
            type='button'
            onClick={action.onClick}
            title={action.title}
            aria-label={action.ariaLabel}
            className={`group flex w-full items-center rounded-3xl py-1.5 transition-colors ${
              isCollapsed ? 'justify-center px-0' : 'justify-start gap-2 px-2'
            }`}
          >
            <span className='acrylic-light flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-transparent text-neutral-700 dark:bg-transparent dark:text-neutral-300 dark:outline dark:outline-1 dark:outline-neutral-400/15'>
              <i
                className={`bx ${action.iconClass} block text-[22px] leading-none transition-transform duration-100 ${
                  action.key === 'theme' ? 'group-active:scale-90' : 'group-hover:scale-108 group-active:scale-95'
                }`}
                aria-hidden='true'
              ></i>
            </span>

            {!isCollapsed && (
              <span className='truncate text-xs md:text-xs lg:text-[12px] xl:text-[14px] 2xl:text-[14px] 3xl:text-[18px] 4xl:text-[20px] dark:text-stone-300'>
                {action.label}
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  )
}

export default SideBar
