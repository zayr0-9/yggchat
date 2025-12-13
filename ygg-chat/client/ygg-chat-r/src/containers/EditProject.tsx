import { useQueryClient } from '@tanstack/react-query'
import React, { useEffect, useState } from 'react'
import { Project, ProjectWithLatestConversation, StorageMode } from '../../../../shared/types'
import { Button, TextField } from '../components'
import { InputTextArea } from '../components/InputTextArea/InputTextArea'
import { createProject, CreateProjectPayload, updateProject, UpdateProjectPayload } from '../features/projects'
import { useAppDispatch } from '../hooks/redux'
import { useAuth } from '../hooks/useAuth'

interface EditProjectProps {
  isOpen: boolean
  onClose: () => void
  editingProject?: Project | null
  onProjectCreated?: (project: Project) => void
}

const EditProject: React.FC<EditProjectProps> = ({ isOpen, onClose, editingProject, onProjectCreated }) => {
  const dispatch = useAppDispatch()
  const queryClient = useQueryClient()
  const { userId } = useAuth()

  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectContext, setNewProjectContext] = useState('')
  const [newProjectSystemPrompt, setNewProjectSystemPrompt] = useState('')
  const [storageMode, setStorageMode] = useState<StorageMode>('cloud')

  // Check if running in Electron
  const isElectronMode =
    import.meta.env.VITE_ENVIRONMENT === 'electron' ||
    (typeof process !== 'undefined' && process.env?.VITE_ENVIRONMENT === 'electron')

  const isEditing = editingProject !== null

  useEffect(() => {
    if (editingProject) {
      setNewProjectName(editingProject.name)
      setNewProjectContext(editingProject.context || '')
      setNewProjectSystemPrompt(editingProject.system_prompt || '')
      setStorageMode(editingProject.storage_mode || 'cloud')
    } else if (isOpen) {
      // Only reset form when opening modal for creating new project
      resetForm()
    }
  }, [editingProject, isOpen])

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return

    const payload: CreateProjectPayload = {
      name: newProjectName.trim(),
      context: newProjectContext.trim() || undefined,
      system_prompt: newProjectSystemPrompt.trim() || undefined,
      storageMode: storageMode,
    }

    try {
      const newProject = await dispatch(createProject(payload)).unwrap()
      resetForm()
      onClose()
      if (onProjectCreated) {
        onProjectCreated(newProject)
      }
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  const handleUpdateProject = async () => {
    if (!newProjectName.trim() || !editingProject) return

    const payload: UpdateProjectPayload = {
      id: editingProject.id,
      name: newProjectName.trim(),
      context: newProjectContext.trim() || undefined,
      system_prompt: newProjectSystemPrompt.trim() || undefined,
      storage_mode: storageMode,
    }

    try {
      const updatedProject = await dispatch(updateProject(payload)).unwrap()

      // Update React Query cache to reflect changes immediately
      // Helper function to update project in cached array
      const updateProjectInCache = (projects: ProjectWithLatestConversation[] | undefined) => {
        if (!projects) return projects
        return projects.map(proj =>
          proj.id === updatedProject.id
            ? {
                ...proj,
                name: updatedProject.name,
                context: updatedProject.context,
                system_prompt: updatedProject.system_prompt,
                updated_at: updatedProject.updated_at,
              }
            : proj
        )
      }

      // Update the main projects list cache
      queryClient.setQueryData<ProjectWithLatestConversation[]>(['projects', userId], updateProjectInCache)

      // Update the individual project cache
      queryClient.setQueryData<Project>(['projects', updatedProject.id], (old: Project | undefined) => {
        if (!old) return updatedProject
        return {
          ...old,
          name: updatedProject.name,
          context: updatedProject.context,
          system_prompt: updatedProject.system_prompt,
          updated_at: updatedProject.updated_at,
        }
      })

      resetForm()
      onClose()
    } catch (error) {
      console.error('Failed to update project:', error)
    }
  }

  const resetForm = () => {
    setNewProjectName('')
    setNewProjectContext('')
    setNewProjectSystemPrompt('')
    setStorageMode('cloud')
  }

  const handleCancel = () => {
    resetForm()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className='fixed inset-0 bg-neutral-400/40 dark:bg-black/30 bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4 text-lg'>
      <div className='bg-neutral-100 mica-medium text-neutral-900 dark:bg-yBlack-900 rounded-3xl border border-gray-200 dark:border-zinc-700 w-full thin-scrollbar max-w-5xl h-full max-h-[83vh] overflow-y-auto thin-scrollbar'>
        <div className='py-6 px-4 sm:px-10 md:px-12 lg:px-12 xl:px-16 2xl:px-15 2xl:py-10 3xl:px-24 4xl:px-24'>
          <div className='flex items-center justify-between space-y-6'>
            <h3 className='text-2xl font-semibold dark:text-neutral-100'>
              {isEditing ? `Edit Project: ${editingProject?.name}` : 'Create New Project'}
            </h3>
            <button
              onClick={onClose}
              className='text-neutral-900 dark:text-neutral-200 hover:text-gray-600 dark:hover:text-gray-300'
            >
              <i className='bx bx-x text-2xl active:scale-95'></i>
            </button>
          </div>

          <div className='space-y-6'>
            <div>
              <label className='block pb-2 block text-[19px] sm:text-[19px] md:text-[19px] lg:text-[19px] xl:text-[19px] 2xl:text-[19px] 3xl:text-[19px] 4xl:text-[19px] text-neutral-900 font-medium mb-2 dark:text-neutral-200'>
                Project Name
              </label>
              <TextField
                placeholder='Enter project name...'
                value={newProjectName}
                onChange={setNewProjectName}
                className='text-lg'
              />
            </div>
            <div className=''>
              <InputTextArea
                label='Context (Optional)'
                placeholder='Project context or description...'
                value={newProjectContext}
                onChange={setNewProjectContext}
                minRows={12}
                maxRows={16}
                width='w-full'
                variant='outline'
                outline={true}
                className='drop-shadow-xl shadow-[0_0px_8px_3px_rgba(0,0,0,0.03),0_0px_2px_0px_rgba(0,0,0,0.05)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)]'
              />
            </div>
            <div>
              <InputTextArea
                label='System Prompt (Optional)'
                placeholder='System prompt for this project...'
                value={newProjectSystemPrompt}
                onChange={setNewProjectSystemPrompt}
                minRows={11}
                maxRows={11}
                width='w-full'
                variant='outline'
                outline={true}
                className='drop-shadow-xl shadow-[0_0px_8px_3px_rgba(0,0,0,0.03),0_0px_2px_0px_rgba(0,0,0,0.05)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0.1)]'
              />
            </div>

            {/* Storage Mode Selection (only in Electron) */}
            {isElectronMode && (
              <div>
                <label className='pb-2 block text-[19px] sm:text-[19px] md:text-[19px] lg:text-[19px] xl:text-[19px] 2xl:text-[19px] 3xl:text-[19px] 4xl:text-[19px] text-neutral-900 font-medium mb-2 dark:text-neutral-200'>
                  Storage Location
                </label>
                <div className='space-y-2'>
                  <label className='flex items-center p-3 rounded-xl border border-gray-300 dark:border-neutral-700 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40'>
                    <input
                      type='radio'
                      value='cloud'
                      checked={storageMode === 'cloud'}
                      onChange={e => setStorageMode(e.target.value as StorageMode)}
                      className='mr-3'
                    />
                    <div>
                      <div className='font-medium dark:text-neutral-100'>Cloud</div>
                      <div className='text-[15px] pt-0.5 text-neutral-700 dark:text-neutral-300'>
                        Synced to Supabase (accessible anywhere) No Agent Support
                      </div>
                    </div>
                  </label>
                  <label className='flex items-center p-3 rounded-xl border border-gray-300 dark:border-neutral-700 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/40'>
                    <input
                      type='radio'
                      value='local'
                      checked={storageMode === 'local'}
                      onChange={e => setStorageMode(e.target.value as StorageMode)}
                      className='mr-3'
                    />
                    <div>
                      <div className='font-medium dark:text-neutral-100'>Local Only</div>
                      <div className='text-[15px] pt-0.5 text-neutral-700 dark:text-neutral-300'>
                        Stored on this device only (not synced) Supports Agent
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            )}

            <div className='flex gap-2 justify-end pt-4'>
              <Button
                variant='outline'
                size='medium'
                className='group'
                onClick={isEditing ? handleUpdateProject : handleCreateProject}
              >
                <p className='transition-transform duration-100 group-active:scale-95'>
                  {isEditing ? 'Update Project' : 'Create Project'}
                </p>
              </Button>
              <Button variant='outline' size='medium' className='group' onClick={handleCancel}>
                <p className='transition-transform duration-100 group-active:scale-95'>Cancel</p>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EditProject
