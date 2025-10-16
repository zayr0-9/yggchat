import { useQueryClient } from '@tanstack/react-query'
import 'boxicons'
import 'boxicons/css/boxicons.min.css'
import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ConversationId } from '../../../../shared/types'
import { Button } from '../components'
import { Select } from '../components/Select/Select'
import { chatSliceActions } from '../features/chats'
import {
  activeConversationIdSet,
  Conversation,
  conversationsLoaded,
  createConversation,
  deleteConversation,
  selectConvError,
} from '../features/conversations'
import { clearSelectedProject, projectsLoaded, selectSelectedProject, setSelectedProject } from '../features/projects'

import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { useConversations, useConversationsByProject, useProject, useProjects } from '../hooks/useQueries'
import { parseId } from '../utils/helpers'
import EditProject from './EditProject'
import SideBar from './sideBar'

const ConversationPage: React.FC = () => {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const projectIdParam = searchParams.get('projectId')
  const projectId = projectIdParam ? parseId(projectIdParam) : null

  // Use React Query for data fetching
  // Fetch project-specific conversations OR all conversations (not both)
  // The enabled flags ensure only one query runs at a time
  const { data: projectConversations = [], isLoading: projectConvsLoading } = useConversationsByProject(projectId)
  // Only fetch all conversations when NOT viewing a specific project
  const { data: allConversations = [], isLoading: allConvsLoading } = useConversations(!projectId)

  // Project data is fetched but not directly used - populates React Query cache
  useProject(projectId)
  const { data: allProjects = [] } = useProjects()

  // Use project conversations if we have a projectId, otherwise use all conversations
  const conversations = projectId ? projectConversations : allConversations
  const loading = projectId ? projectConvsLoading : allConvsLoading

  // Sync React Query data to Redux
  // Simple approach: just load the conversations from React Query
  // The optimistic update in Chat.tsx handles both React Query AND Redux
  useEffect(() => {
    if (conversations.length > 0) {
      dispatch(conversationsLoaded(conversations))
    }
  }, [conversations, dispatch])

  useEffect(() => {
    if (allProjects.length > 0) {
      dispatch(projectsLoaded(allProjects))
    }
  }, [allProjects, dispatch])

  // Set selected project based on URL parameter
  useEffect(() => {
    if (projectId && allProjects.length > 0) {
      const project = allProjects.find(p => p.id === projectId)
      if (project) {
        dispatch(setSelectedProject(project))
      }
    } else if (!projectId) {
      dispatch(clearSelectedProject())
    }
  }, [projectId, allProjects, dispatch])

  const selectedProject = useAppSelector(selectSelectedProject)
  const error = useAppSelector(selectConvError)

  const [showEditProjectModal, setShowEditProjectModal] = useState(false)
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'name'>('updated')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  // Sorting function for conversations
  const sortConversations = (
    convs: Conversation[],
    sortBy: 'updated' | 'created' | 'name',
    invert: boolean = false
  ) => {
    const sorted = [...convs].sort((a, b) => {
      switch (sortBy) {
        case 'updated':
          // Use updated_at if available, otherwise fall back to created_at
          const aDate = a.updated_at || a.created_at || ''
          const bDate = b.updated_at || b.created_at || ''
          if (!aDate) return 1
          if (!bDate) return -1
          return bDate.localeCompare(aDate)

        case 'created':
          if (!a.created_at) return 1
          if (!b.created_at) return -1
          return b.created_at.localeCompare(a.created_at)

        case 'name':
          const aTitle = a.title || `Conversation ${a.id}`
          const bTitle = b.title || `Conversation ${b.id}`
          return aTitle.localeCompare(bTitle)

        default:
          return 0
      }
    })

    return invert ? sorted.reverse() : sorted
  }

  // Sort conversations
  const sortedConversations = sortConversations(conversations, sortBy, sortOrder === 'asc')

  // Search dropdown is handled inside SearchList component

  useEffect(() => {
    dispatch(chatSliceActions.stateReset())
    dispatch(chatSliceActions.heimdallDataLoaded({ treeData: null }))

    // Conversations and project are now fetched via React Query hooks above
    // No need to dispatch Redux actions - React Query handles caching and deduplication
  }, [dispatch])

  // Dropdown open/close is managed internally by SearchList

  const handleSelect = (conv: Conversation) => {
    dispatch(chatSliceActions.conversationSet(conv.id))
    navigate(`/chat/${conv.project_id}/${conv.id}`)
    dispatch(activeConversationIdSet(conv.id))
  }

  const handleDelete = async (id: ConversationId) => {
    await dispatch(deleteConversation({ id }))

    // Optimistically update React Query caches to remove the deleted conversation
    // Update all conversations cache
    queryClient.setQueryData(['conversations'], (old: Conversation[] | undefined) => {
      return old ? old.filter(c => c.id !== id) : []
    })

    // Update project-specific conversations cache
    if (projectId) {
      queryClient.setQueryData(['conversations', 'project', projectId], (old: Conversation[] | undefined) => {
        return old ? old.filter(c => c.id !== id) : []
      })
    }

    // Update recent conversations cache (used by SideBar)
    queryClient.setQueryData(['conversations', 'recent'], (old: Conversation[] | undefined) => {
      return old ? old.filter(c => c.id !== id) : []
    })
  }

  const handleNewConversation = async () => {
    // TODO: Link conversation to project when backend supports it
    const payload = selectedProject
      ? {
          title: `${selectedProject.name} Conversation`,
          // Add project_id when backend supports it
        }
      : {}
    const result = await dispatch(createConversation(payload)).unwrap()
    // dispatch(fetchProjectById(result.project_id))

    // Optimistically update React Query cache to avoid refetch (scales better)
    // Update all conversations cache - prepend new conversation (newest first)
    queryClient.setQueryData(['conversations'], (old: Conversation[] | undefined) => {
      return old ? [result, ...old] : [result]
    })

    // Update project-specific conversations cache
    if (result.project_id) {
      queryClient.setQueryData(['conversations', 'project', result.project_id], (old: Conversation[] | undefined) => {
        return old ? [result, ...old] : [result]
      })
    }

    // Update recent conversations cache (used by SideBar) - prepend new conversation
    queryClient.setQueryData(['conversations', 'recent'], (old: Conversation[] | undefined) => {
      return old ? [result, ...old] : [result]
    })

    handleSelect(result)
  }

  const handleEditProject = () => {
    setShowEditProjectModal(true)
  }

  const handleCloseEditProjectModal = () => {
    setShowEditProjectModal(false)
  }

  return (
    <div className='bg-zinc-50 min-h-screen dark:bg-zinc-900 flex'>
      {/* Recent conversations sidebar */}
      <SideBar limit={12} projects={allProjects} />
      {/* Main content with flex layout */}
      <div className='flex-1 mr-35 ml-15 transition-all py-6 duration-300'>
        <div className='py-4  max-w-[1640px] mx-auto'>
          <div className='flex items-center justify-between mb-8'>
            <div className='flex items-center gap-2 pt-2 mb-2'>
              <Button
                variant='outline'
                rounded='full'
                size='circle'
                onClick={() => navigate('/homepage')}
                className='group border-2 hover:bg-pureWhite-100 dark:hover:bg-neutral-900 border-pureWhite-200 dark:border-neutral-800 shadow-[0_0px_8px_-4px_rgba(0,0,0,0.5)] dark:shadow-[0_1px_22px_1px_rgba(0,0,0,0.45)]'
              >
                <i
                  className='bx bx-home text-3xl pb-0.75 transition-transform group-hover:scale-101 duration-100 group-active:scale-93 pointer-events-none'
                  aria-hidden='true'
                ></i>
              </Button>
              <h1 className='text-5xl py-4 px-2 font-bold dark:text-neutral-100'>
                {selectedProject ? `${selectedProject.name}` : 'Conversations'}
              </h1>
              {/* {selectedProject && (
                <Button variant='secondary' size='small' onClick={handleEditProject}>
                  <i className='bx bx-edit text-lg' aria-hidden='true'></i>
                </Button>
              )} */}
            </div>
            {/* {selectedProject?.context && (
              <p className='text-sm text-gray-600 ygg-line-clamp-6 dark:text-gray-300 ml-12'>
                {selectedProject.context}
              </p>
            )} */}
          </div>
        </div>
        <div className='p-6 max-w-7xl mx-auto'>
          <div className='mb-4 flex items-center justify-between max-w-5xl'>
            <h2 className='text-3xl py-4 font-bold dark:text-neutral-100'>Conversations</h2>
            <div className='flex items-center gap-2 pt-4 pr-4'>
              <Button variant='outline' size='medium' onClick={handleEditProject} className='group'>
                <p className='transition-transform duration-100 group-active:scale-95'>Project Settings</p>
              </Button>
            </div>
          </div>
          {/* New Conversation + Sort Controls + Search inline row */}
          <div className='mb-6 flex items-center gap-3'>
            <Button variant='outline' size='large' onClick={handleNewConversation} className='group'>
              <p className='transition-transform duration-100 group-active:scale-95'>New Conversation</p>
            </Button>

            <div className='flex items-center gap-2'>
              <span className='text-sm text-gray-600 dark:text-gray-300'>Sort by:</span>
              <Select
                value={sortBy}
                onChange={value => setSortBy(value as 'updated' | 'created' | 'name')}
                options={[
                  { value: 'updated', label: 'Updated' },
                  { value: 'created', label: 'Created' },
                  { value: 'name', label: 'Name' },
                ]}
                className='w-32 transition-transform duration-70 active:scale-95'
              />
              <Button
                variant='outline2'
                size='medium'
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className='shrink-0 group'
              >
                <i
                  className={`bx ${sortOrder === 'asc' ? 'bx-sort-up' : 'bx-sort-down'} text-lg transition-transform duration-100 group-active:scale-90 pointer-events-none`}
                  aria-hidden='true'
                ></i>
              </Button>
            </div>
          </div>

          {loading && <p>Loading...</p>}
          {error && <p className='text-red-500'>{error}</p>}
          <div className='flex gap-4 pt-5 items-start max-w-5xl'>
            <ul className='space-y-2 px-2 py-8 rounded flex-2 overflow-y-auto max-h-[65vh] pr-2 thin-scrollbar scroll-fade'>
              {sortedConversations.map(conv => (
                <li
                  key={conv.id}
                  className='px-3 pb-4 pt-2 mb-6 bg-indigo-50 rounded-lg cursor-pointer dark:bg-yBlack-900 dark:outline-1 dark:outline-neutral-800 hover:bg-indigo-100 dark:hover:bg-yBlack-800 dark:hover:outline-neutral-600 group dark:shadow-[0px_6px_12px_-12px_rgba(0,0,0,0.45),0px_6px_12px_-8px_rgba(0,0,0,0.2)]'
                  onClick={() => handleSelect(conv)}
                >
                  <div className='flex items-center justify-between'>
                    <span className='font-semibold text-lg dark:text-neutral-300 transition-transform duration-100 group-active:scale-99'>
                      {conv.title || `Conversation ${conv.id}`}
                    </span>
                    <Button
                      variant='outline2'
                      size='smaller'
                      onClick={
                        (e => {
                          ;(e as unknown as React.MouseEvent).stopPropagation()
                          handleDelete(conv.id)
                        }) as unknown as () => void
                      }
                    >
                      <i className='bx bx-trash-alt text-lg' aria-hidden='true'></i>
                    </Button>
                  </div>
                  {conv.created_at && (
                    <div className='text-xs mt-2 text-neutral-900 dark:text-neutral-300 transition-transform duration-100 group-active:scale-99'>
                      {new Date(conv.created_at).toLocaleString()}
                    </div>
                  )}
                </li>
              ))}
              {sortedConversations.length === 0 && !loading && (
                <p className='dark:text-neutral-300'>No conversations yet.</p>
              )}
            </ul>
          </div>
        </div>
      </div>

      <EditProject
        isOpen={showEditProjectModal}
        onClose={handleCloseEditProjectModal}
        editingProject={selectedProject}
      />
    </div>
  )
}

export default ConversationPage
