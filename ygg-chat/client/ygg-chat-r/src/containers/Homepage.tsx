import { useQueryClient } from '@tanstack/react-query'
import 'boxicons'
import 'boxicons/css/boxicons.min.css'
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Project, ProjectId, ProjectWithLatestConversation } from '../../../../shared/types'
import { Button } from '../components'
import { Select } from '../components/Select/Select'
import { chatSliceActions } from '../features/chats'
import { deleteProject, projectsLoaded, setSelectedProject } from '../features/projects'
import { useAppDispatch } from '../hooks/redux'
import { useAuth } from '../hooks/useAuth'
import { useProjects } from '../hooks/useQueries'
import { sortProjects } from '../utils/sortProjects'
import EditProject from './EditProject'
import SideBar from './sideBar'

const Homepage: React.FC = () => {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { userId } = useAuth()

  // Use React Query for data fetching (with automatic caching and deduplication)
  // Projects now include latest_conversation_updated_at, eliminating need to fetch all conversations
  const { data: allProjects = [], isLoading: loading } = useProjects()

  // Sync React Query data to Redux
  useEffect(() => {
    if (allProjects.length > 0) {
      dispatch(projectsLoaded(allProjects))
    }
  }, [allProjects, dispatch])

  //   const error = useAppSelector(selectProjectsError)

  const [showEditModal, setShowEditModal] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectWithLatestConversation | null>(null)
  // Search dropdown is handled inside SearchList component
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'name'>('updated')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const projects = sortProjects(allProjects, sortBy, sortOrder === 'asc')

  useEffect(() => {
    dispatch(chatSliceActions.stateReset())
    dispatch(chatSliceActions.heimdallDataLoaded({ treeData: null }))

    // Projects and conversations are now fetched via React Query hooks above
    // No need to dispatch Redux actions for fetching - React Query handles caching and deduplication
  }, [dispatch])

  // Dropdown open/close is managed internally by SearchList

  const handleSelectProject = (project: ProjectWithLatestConversation) => {
    dispatch(setSelectedProject(project))
    navigate(`/conversationPage?projectId=${project.id}`)
  }

  const handleProjectCreated = (project: Project) => {
    // Optimistically update React Query cache to avoid refetch (scales better)
    queryClient.setQueryData(['projects', userId], (old: ProjectWithLatestConversation[] | undefined) => {
      // Convert Project to ProjectWithLatestConversation by adding the required field
      const projectWithLatest: ProjectWithLatestConversation = {
        ...project,
        latest_conversation_updated_at: null,
      }
      return old ? [projectWithLatest, ...old] : [projectWithLatest]
    })

    // Navigate to the newly created project
    const projectWithLatest: ProjectWithLatestConversation = {
      ...project,
      latest_conversation_updated_at: null,
    }
    handleSelectProject(projectWithLatest)
  }

  const handleDeleteProject = (id: ProjectId) => {
    dispatch(deleteProject(id))
  }

  const handleCloseModal = () => {
    setShowEditModal(false)
    setEditingProject(null)
  }

  const handleEditProject = (project: ProjectWithLatestConversation) => {
    setEditingProject(project)
    setShowEditModal(true)
  }

  const handleCreateProject = () => {
    setEditingProject(null)
    setShowEditModal(true)
  }

  const { signOut } = useAuth()
  const handleLogout = async () => {
    await signOut()
    // The ProtectedRoute component will automatically redirect to /login
  }

  return (
    <div className='bg-zinc-50 min-h-screen dark:bg-yBlack-500 flex'>
      <SideBar limit={12} projects={allProjects} />
      {/* Main content with flex layout */}
      <div className='flex-1 mr-35 ml-15 transition-all duration-300'>
        <div className='py-4 max-w-[1640px] mx-auto'>
          <div className='flex items-center justify-baseline px-2 py-10'>
            <div className='flex items-center flex-wrap gap-3 rounded-full'>
              <img
                src='/img/logo-d.svg'
                alt='Yggdrasil Logo'
                className='w-22 h-22 dark:hidden rounded-full shadow-[0_2px_16px_3px_rgba(0,0,0,0.05)]'
              />
              <img
                src='/img/logo-l.svg'
                alt='Yggdrasil Logo'
                className='w-22 h-22 hidden dark:block rounded-full dark:shadow-[0_2px_16px_3px_rgba(0,0,0,0.55)]'
              />
              <h1 className='text-5xl font-bold px-3 dark:text-neutral-100 '>Yggdrasil</h1>
            </div>
          </div>
        </div>
        <div className='p-6 max-w-7xl mx-auto'>
          <div className='mb-4 flex items-center justify-between'>
            <h2 className='text-3xl py-4 font-bold dark:text-neutral-100'>Projects</h2>
            <div className='flex items-center gap-2 pt-2'>
              <Button
                variant='outline2'
                size='smaller'
                onClick={handleLogout}
                rounded='full'
                title='Logout'
                aria-label='Logout'
                className='group'
              >
                <i
                  className='bx bx-log-out text-3xl p-1 transition-transform duration-100 group-active:scale-90 pointer-events-none'
                  aria-hidden='true'
                ></i>
              </Button>
              <Button
                variant='outline2'
                size='smaller'
                onClick={() => navigate('/settings')}
                className='group'
                rounded='full'
              >
                <i
                  className='bx bx-cog text-3xl p-1 transition-transform duration-100 group-active:scale-90 pointer-events-none'
                  aria-hidden='true'
                ></i>
              </Button>
            </div>
          </div>

          {/* New Project Button + Sort Controls + Search */}
          <div className='mb-6 flex flex-wrap items-center gap-3'>
            <Button variant='outline' size='large' onClick={handleCreateProject} className='shrink-0 group'>
              <p className='transition-transform duration-100 group-active:scale-95'>New Project</p>
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
          {/* {error && <p className='text-red-500'>{error}</p>} */}

          <div className='gap-4 items-start max-w-5xl '>
            <ul className='scroll-fade space-y-2 px-2 py-8 rounded flex-wrap overflow-y-auto max-h-[65vh] pr-2 thin-scrollbar'>
              {projects.map(project => (
                <li
                  key={project.id}
                  className='p-4 mb-4 bg-indigo-50 rounded-lg cursor-pointer  border-indigo-100 dark:border-neutral-600 dark:bg-yBlack-900 hover:bg-indigo-100 dark:outline-1 dark:outline-neutral-800 dark:hover:bg-yBlack-800 dark:hover:outline-neutral-600 group dark:shadow-[0px_6px_12px_-12px_rgba(0,0,0,0.45),0px_6px_12px_-8px_rgba(0,0,0,0.2)]'
                  onClick={() => handleSelectProject(project)}
                >
                  <div className='flex place-items-start justify-between'>
                    <div className='flex-1'>
                      <span className='font-semibold text-xl dark:text-neutral-100 transition-transform duration-100 group-active:scale-99'>
                        <p className='transition-transform duration-100 group-active:scale-99'>{project.name}</p>
                      </span>
                      {project.context && (
                        <p className='text-sm text-gray-600 ygg-line-clamp-6 dark:text-gray-300 mt-2 mr-2 transition-transform duration-100 group-active:scale-99'>
                          {project.context}
                        </p>
                      )}
                    </div>
                    <div className='flex gap-2'>
                      <Button
                        variant='outline2'
                        size='small'
                        className='group'
                        onClick={
                          (e => {
                            ;(e as unknown as React.MouseEvent).stopPropagation()
                            handleEditProject(project)
                          }) as unknown as () => void
                        }
                      >
                        <i
                          className='bx bx-edit text-lg transition-transform duration-100 group-active:scale-90 pointer-events-none'
                          aria-hidden='true'
                        ></i>
                      </Button>
                      <Button
                        variant='outline2'
                        size='small'
                        className='group'
                        onClick={
                          (e => {
                            ;(e as unknown as React.MouseEvent).stopPropagation()
                            handleDeleteProject(project.id)
                          }) as unknown as () => void
                        }
                      >
                        <i
                          className='bx bx-trash-alt text-lg transition-transform duration-100 group-active:scale-90 pointer-events-none'
                          aria-hidden='true'
                        ></i>
                      </Button>
                    </div>
                  </div>
                  {project.created_at && (
                    <div className='text-xs text-neutral-600 dark:text-neutral-300 mt-2 transition-transform duration-100 group-active:scale-99'>
                      Created: {new Date(project.created_at).toLocaleString()}
                    </div>
                  )}
                </li>
              ))}
              {projects.length === 0 && !loading && (
                <p className='dark:text-neutral-300'>No projects yet. Create your first project to get started!</p>
              )}
            </ul>
          </div>
        </div>
      </div>

      <EditProject
        isOpen={showEditModal}
        onClose={handleCloseModal}
        editingProject={editingProject}
        onProjectCreated={handleProjectCreated}
      />
    </div>
  )
}

export default Homepage
