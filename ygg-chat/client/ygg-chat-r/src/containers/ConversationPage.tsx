import { useQueryClient } from '@tanstack/react-query'
import 'boxicons'
import 'boxicons/css/boxicons.min.css'
import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { StorageMode } from '../../../../shared/types'
import { Button } from '../components'
import { LowBar } from '../components/LowBar/LowBar'
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
import { useIsMobile } from '../hooks/useMediaQuery'
import {
  useConversations,
  useConversationsByProject,
  useProject,
  useProjects,
  useResearchNotes,
} from '../hooks/useQueries'
import { parseId } from '../utils/helpers'
import EditProject from './EditProject'
import SideBar from './sideBar'

const ConversationPage: React.FC = () => {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const [searchParams] = useSearchParams()
  const projectIdParam = searchParams.get('projectId')
  const projectId = projectIdParam ? parseId(projectIdParam) : null

  // Check if running in Electron
  const isElectronMode =
    import.meta.env.VITE_ENVIRONMENT === 'electron' ||
    (typeof process !== 'undefined' && process.env?.VITE_ENVIRONMENT === 'electron')

  // Use React Query for data fetching
  // Fetch project-specific conversations OR all conversations (not both)
  // The enabled flags ensure only one query runs at a time
  const {
    data: projectConversations = [],
    isLoading: projectConvsLoading,
    isRefetching: projectConvsRefetching,
    refetch: refetchProjectConversations,
  } = useConversationsByProject(projectId)
  // Only fetch all conversations when NOT viewing a specific project
  const {
    data: allConversations = [],
    isLoading: allConvsLoading,
    isRefetching: allConvsRefetching,
    refetch: refetchAllConversations,
  } = useConversations(!projectId)

  // Project data is fetched but not directly used - populates React Query cache
  useProject(projectId)
  const { data: allProjects = [] } = useProjects()

  // Fetch research notes for display in LowBar
  const { data: researchNotes = [], isLoading: notesLoading } = useResearchNotes()

  // Use project conversations if we have a projectId, otherwise use all conversations
  const conversations = projectId ? projectConversations : allConversations
  const loading = projectId ? projectConvsLoading : allConvsLoading
  const isRefetching = projectId ? projectConvsRefetching : allConvsRefetching
  const refetchConversations = projectId ? refetchProjectConversations : refetchAllConversations

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null)
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'name'>('updated')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showNewConversationModal, setShowNewConversationModal] = useState(false)
  const [newConvTitle, setNewConvTitle] = useState('')
  const [storageMode, setStorageMode] = useState<StorageMode>('cloud')
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

  const handleDelete = (conversation: Conversation) => {
    setConversationToDelete(conversation)
    setShowDeleteConfirm(true)
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const confirmDelete = async () => {
    if (!conversationToDelete) return

    const id = conversationToDelete.id
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

    setShowDeleteConfirm(false)
    setConversationToDelete(null)
  }

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false)
    setConversationToDelete(null)
  }

  const handleNewConversation = async () => {
    // If a project is selected, skip modal and use project's storage mode
    if (selectedProject) {
      const projectStorageMode = selectedProject.storage_mode || 'cloud'
      const defaultTitle = `${selectedProject.name} Conversation`
      await createNewConversation(projectStorageMode, defaultTitle)
      return
    }

    // No project selected: in Electron mode, show modal to choose storage
    if (isElectronMode) {
      setNewConvTitle('New Conversation')
      setStorageMode('cloud') // Default to cloud
      setShowNewConversationModal(true)
    } else {
      // Web mode: create cloud conversation directly
      await createNewConversation('cloud')
    }
  }

  const createNewConversation = async (mode: StorageMode, title?: string) => {
    const payload = {
      title: title || (selectedProject ? `${selectedProject.name} Conversation` : undefined),
      storageMode: mode,
    }
    const result = await dispatch(createConversation(payload)).unwrap()

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

  const handleConfirmNewConversation = async () => {
    await createNewConversation(storageMode, newConvTitle)
    setShowNewConversationModal(false)
    setNewConvTitle('')
  }

  const handleEditProject = () => {
    setShowEditProjectModal(true)
  }

  const handleCloseEditProjectModal = () => {
    setShowEditProjectModal(false)
  }

  const handleRefreshConversations = async () => {
    // Manually refetch conversations from the server
    await refetchConversations()

    // Also invalidate and refetch related caches for a complete refresh
    queryClient.invalidateQueries({ queryKey: ['conversations', 'recent'] })
    queryClient.invalidateQueries({ queryKey: ['projects'] })
    queryClient.invalidateQueries({ queryKey: ['research-notes'] })
  }

  return (
    <div className='bg-zinc-50 dark:bg-zinc-900 flex overflow-hidden h-full'>
      {/* Dark Overlay */}
      <div className='absolute inset-0 w-full h-full bg-neutral-200/15 dark:bg-black/30 z-0' />
      {/* Recent conversations sidebar */}
      {!isMobile && <SideBar limit={12} projects={allProjects} />}
      {/* Main content with flex layout - Responsive margins for different displays */}
      <div className='relative z-10 flex-1 h-full flex flex-col overflow-hidden w-full mx-1 sm:mr-4 sm:ml-4 md:mr-8 md:ml-8 lg:mr-15 lg:ml-15 xl:mr-20 xl:ml-15 2xl:mr-25 2xl:ml-15 3xl:mr-35 3xl:ml-20 transition-all px-2 duration-300'>
        <div className='py-4 w-full max-w-full mx-auto shrink-0'>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex items-center gap-2 pt-2 mb-2'>
              <Button
                variant='acrylic'
                rounded='full'
                size='circle'
                onClick={() => navigate('/homepage')}
                className='group border-2 hover:bg-pureWhite-100 dark:hover:bg-neutral-900 border-pureWhite-200 dark:border-neutral-800 shadow-[0_0px_8px_-4px_rgba(0,0,0,0.5)] dark:shadow-[0_1px_22px_1px_rgba(0,0,0,0.45)]'
              >
                <i
                  className='bx bx-home text-[24px] sm:text-[14px] md:text-[25px] lg:text-[30px] 2xl:text-[38px] 3xl:text-[28px] 4xl:text-[32px] pb-0.75 transition-transform group-hover:scale-101 duration-100 group-active:scale-93 pointer-events-none'
                  aria-hidden='true'
                ></i>
              </Button>
              <h1 className='text-[26px] pl-1 sm:text-[28px] lg:text-[28px] xl:text-[34px] 2xl:text-[34px] 3xl:text-[44px] 4xl:text-[44px] xl:p-2 lg:p-1 md:p-2 sm:p-2 font-bold dark:text-neutral-100'>
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
        <div className='px-1 sm:px-4 md:px-6 w-full max-w-full md:max-w-4xl lg:max-w-5xl xl:max-w-6xl 2xl:max-w-6xl 3xl:max-w-7xl 4xl:max-w-[2400px] mx-auto flex-1 overflow-hidden flex flex-col'>
          <div className='mb-4 flex items-center justify-between max-w-full '>
            <h2 className='text-[20px] md:text-[22px] lg:text-[22px] xl:text-[22px] 2xl:text-[38px] 3xl:text-[38px] 4xl:text-[38px] xl:py-2 lg:py-1 md:py-2 sm:py-2 font-bold dark:text-neutral-100'>
              Chats
            </h2>
            <div className='flex items-center gap-2 my-1 p-0 lg:p-1 '>
              <Button
                variant='acrylic'
                size='large'
                rounded='full'
                onClick={handleEditProject}
                className='group dark:hover:bg-neutral-800 transition-all hover:scale-98 duration-200 shadow-[0px_0px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0px_16px_1px_rgba(0,0,0,0.45)]'
              >
                <p className='transition-transform duration-100 text-black dark:text-neutral-100 group-active:scale-95'>
                  Project Settings
                </p>
              </Button>
            </div>
          </div>
          {/* New Conversation + Sort Controls + Search inline row */}
          <div className='mb-0 z-500 flex p-2 px-2 flex-wrap justify-between acrylic-ultra-light items-center gap-3 outline-2 dark:outline-neutral-300/20 outline-neutral-50/10 rounded-4xl shadow-[0px_0px_7px_-2.5px_rgba(0,0,0,0.45)] dark:shadow-[0px_0px_16px_-2px_rgba(0,0,0,0.45)] 2xl:p-3'>
            <div className='flex items-center gap-1'>
              <Button
                variant='acrylic'
                size='large'
                rounded='full'
                onClick={handleNewConversation}
                className='group dark:outline-2 rounded-4xl dark:hover:bg-neutral-800 transition-all hover:scale-98 duration-200 shadow-[0px_0px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0px_16px_2px_rgba(0,0,0,0.45)] dark:outline-neutral-300/20'
              >
                <p className='transition-transform duration-100 text-black dark:text-neutral-100 group-active:scale-95'>
                  New Chat
                </p>
              </Button>
            </div>

            <div className='flex items-center gap-1'>
              <Select
                value={sortBy}
                onChange={value => setSortBy(value as 'updated' | 'created' | 'name')}
                options={[
                  { value: 'updated', label: 'Updated' },
                  { value: 'created', label: 'Created' },
                  { value: 'name', label: 'Name' },
                ]}
                className='w-28 ml-1 transition-transform duration-70 active:scale-95'
              />
              <Button
                variant='acrylic'
                size='circle'
                rounded='full'
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className='shrink-0 ml-1 group'
              >
                <i
                  className={`bx ${sortOrder === 'asc' ? 'bx-sort-up' : 'bx-sort-down'} text-xl transition-transform duration-100 group-active:scale-90 pointer-events-none`}
                  aria-hidden='true'
                ></i>
              </Button>

              <Button
                variant='acrylic'
                size='circle'
                rounded='full'
                onClick={handleRefreshConversations}
                disabled={isRefetching}
                className='group ml-1 dark:outline-2 rounded-full transition-all hover:scale-98 duration-200 shadow-[0px_0px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0px_16px_2px_rgba(0,0,0,0.45)] dark:outline-neutral-300/20'
                title='Refresh conversations from server'
              >
                <i
                  className={`bx bx-refresh text-xl transition-transform duration-100 group-active:scale-90 pointer-events-none ${
                    isRefetching ? 'animate-spin' : ''
                  }`}
                  aria-hidden='true'
                ></i>
              </Button>
            </div>
          </div>

          {loading && <p>Loading...</p>}
          {error && <p className='text-red-500'>{error}</p>}
          <div className='gap-2 sm:gap-1 md:gap-2 px-3 items-start w-full max-w-full lg:max-w-full flex-1 overflow-hidden flex flex-col'>
            <div className='scroll-fade-container w-full overflow-y-auto thin-scrollbar '>
              <ul className='project-list no-scrollbar space-y-4 px-1 sm:px-2 py-8 sm:py-6 2xl:py-12 3xl:py-14 rounded flex-1 pr-2 w-full'>
                {sortedConversations.map((conv, index) => (
                  <li
                    key={conv.id}
                    className='rounded-4xl px-3 py-3 sm:p-2 md:px-4 acrylic-light md:py-2 lg:px-3.5 lg:pt-2 lg:pb-2.5 xl:px-4 xl:py-3 2xl:px-4 2xl:py-4 3xl:p-4 4xl:p-4 mb-4 sm:mb-3 md:mb-3 lg:mb-3 xl:mb-4 2xl:mb-4 3xl:mb-6 bg-neutral-50 cursor-pointer border-indigo-100 dark:border-neutral-600 dark:bg-yBlack-900 hover:bg-neutral-100 dark:outline-1 dark:outline-neutral-800 dark:hover:bg-yBlack-800 dark:hover:outline-neutral-700 group shadow-[0px_0px_8px_-2px_rgba(0,0,0,0.15)] dark:shadow-[0px_0px_8px_1px_rgba(0,0,0,0.65)]'
                    onClick={() => handleSelect(conv)}
                  >
                    <div className='flex items-center justify-between'>
                      <div className='flex items-center gap-2 flex-1 min-w-0'>
                        <span className='font-semibold dark:text-neutral-300 transition-transform duration-100 group-active:scale-99 text-[14px] sm:text-[13px] md:text-[13px] lg:text-[14px] xl:text-[16px] 2xl:text-[18px] 3xl:text-[20px] 4xl:text-[22px] truncate'>
                          {String(index + 1).padStart(2, '0')}. {conv.title || `Conversation ${conv.id}`}
                        </span>
                        {conv.storage_mode === 'local' && (
                          <span className='inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 shrink-0'>
                            Local
                          </span>
                        )}
                        {isElectronMode && conv.storage_mode === 'cloud' && (
                          <span className='inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 shrink-0'>
                            Cloud
                          </span>
                        )}
                      </div>
                      <Button
                        variant='outline2'
                        size='circle'
                        rounded='full'
                        className='acrylic-ultra-light dark:shadow-[0px_0px_4px_1px_rgba(0,0,0,0.15)] hover:scale-105 transition-transform duration-300 active:scale-95 shrink-0 ml-2'
                        onClick={
                          (e => {
                            ;(e as unknown as React.MouseEvent).stopPropagation()
                            handleDelete(conv)
                          }) as unknown as () => void
                        }
                      >
                        <i className='bx bx-trash-alt text-lg' aria-hidden='true'></i>
                      </Button>
                    </div>
                    {conv.created_at && (
                      <div className='text-xs mt-2 text-neutral-900 dark:text-neutral-300 transition-transform duration-100 group-active:scale-99 text-[12px] sm:text-[11px] md:text-[11px] lg:text-[10px] xl:text-[12px] 2xl:text-[14px] 3xl:text-[16px] 4xl:text-[16px]'>
                        {new Date(conv.created_at).toLocaleString()}
                      </div>
                    )}
                  </li>
                ))}
                {sortedConversations.length === 0 && !loading && (
                  <p className='dark:text-neutral-300 rounded-3xl p-4 acrylic-light'>No conversations yet.</p>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <EditProject
        isOpen={showEditProjectModal}
        onClose={handleCloseEditProjectModal}
        editingProject={selectedProject}
      />

      {/* New Conversation Modal */}
      {showNewConversationModal && (
        <div className='fixed inset-0 bg-neutral-400/40 dark:bg-black/30 bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4'>
          <div className='bg-neutral-100 text-neutral-900 mica-medium dark:bg-yBlack-900 rounded-3xl border border-gray-200 dark:border-zinc-700 w-full max-w-md p-6 shadow-[0_8px_32px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)]'>
            <h3 className='text-xl font-semibold mb-4 dark:text-neutral-100'>Create New Conversation</h3>

            <div className='mb-4'>
              <label className='block text-sm font-medium mb-2 dark:text-neutral-300'>Title (optional)</label>
              <input
                type='text'
                value={newConvTitle}
                onChange={e => setNewConvTitle(e.target.value)}
                placeholder='Enter conversation title...'
                className='w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
              />
            </div>

            <div className='mb-6'>
              <label className='block text-sm font-medium mb-2 dark:text-neutral-300'>Storage Location</label>
              <div className='space-y-2'>
                <label className='flex items-center p-3 rounded-xl border border-gray-300 dark:border-neutral-700 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800'>
                  <input
                    type='radio'
                    value='cloud'
                    checked={storageMode === 'cloud'}
                    onChange={e => setStorageMode(e.target.value as StorageMode)}
                    className='mr-3'
                  />
                  <div>
                    <div className='font-medium dark:text-neutral-100'>Cloud</div>
                    <div className='text-xs text-neutral-600 dark:text-neutral-400'>
                      Synced to Supabase (accessible anywhere)
                    </div>
                  </div>
                </label>
                <label className='flex items-center p-3 rounded-xl border border-gray-300 dark:border-neutral-700 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800'>
                  <input
                    type='radio'
                    value='local'
                    checked={storageMode === 'local'}
                    onChange={e => setStorageMode(e.target.value as StorageMode)}
                    className='mr-3'
                  />
                  <div>
                    <div className='font-medium dark:text-neutral-100'>Local Only</div>
                    <div className='text-xs text-neutral-600 dark:text-neutral-400'>
                      Stored on this device only (not synced)
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className='flex gap-3 justify-end'>
              <Button
                variant='acrylic'
                size='circle'
                rounded='full'
                className='group'
                onClick={() => setShowNewConversationModal(false)}
              >
                <p className='transition-transform duration-100 group-active:scale-95'>Cancel</p>
              </Button>
              <Button
                variant='acrylic'
                size='circle'
                rounded='full'
                className='group bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white border-blue-600 dark:border-blue-700'
                onClick={handleConfirmNewConversation}
              >
                <p className='transition-transform duration-100 group-active:scale-95'>Create</p>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && conversationToDelete && (
        <div className='fixed inset-0 bg-neutral-400/40 dark:bg-black/30 bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4'>
          <div className='bg-neutral-100 text-neutral-900 mica-medium dark:bg-yBlack-900 rounded-3xl border border-gray-200 dark:border-zinc-700 w-full max-w-md p-6 shadow-[0_8px_32px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)]'>
            <h3 className='text-xl font-semibold mb-2 dark:text-neutral-100'>Delete Chat?</h3>
            <p className='text-sm text-neutral-600 dark:text-neutral-400 mb-4'>
              Are you sure you want to delete "
              <span className='font-medium'>
                {conversationToDelete.title || `Conversation ${conversationToDelete.id}`}
              </span>
              "? This action cannot be undone.
            </p>
            <div className='flex gap-3 justify-end'>
              <Button variant='acrylic' size='circle' rounded='full' className='group' onClick={handleCancelDelete}>
                <p className='transition-transform duration-100 group-active:scale-95'>Cancel</p>
              </Button>
              <Button
                variant='acrylic'
                size='circle'
                rounded='full'
                className='group bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 text-black dark:text-white border-red-600 dark:border-red-700'
                onClick={confirmDelete}
              >
                <p className='transition-transform duration-100 group-active:scale-95'>Delete</p>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Research Notes List - Fixed bottom-right */}
      <LowBar conversationId={null} mode='list' notes={researchNotes} isLoadingNotes={notesLoading} />
    </div>
  )
}

export default ConversationPage
