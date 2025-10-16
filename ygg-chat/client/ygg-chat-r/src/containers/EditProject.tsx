import React, { useEffect, useState } from 'react'
import { Project } from '../../../../shared/types'
import { Button, TextField } from '../components'
import { InputTextArea } from '../components/InputTextArea/InputTextArea'
import { createProject, CreateProjectPayload, updateProject, UpdateProjectPayload } from '../features/projects'
import { useAppDispatch } from '../hooks/redux'

interface EditProjectProps {
  isOpen: boolean
  onClose: () => void
  editingProject?: Project | null
  onProjectCreated?: (project: Project) => void
}

const EditProject: React.FC<EditProjectProps> = ({ isOpen, onClose, editingProject, onProjectCreated }) => {
  const dispatch = useAppDispatch()

  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectContext, setNewProjectContext] = useState('')
  const [newProjectSystemPrompt, setNewProjectSystemPrompt] = useState('')

  const isEditing = editingProject !== null

  useEffect(() => {
    if (editingProject) {
      setNewProjectName(editingProject.name)
      setNewProjectContext(editingProject.context || '')
      setNewProjectSystemPrompt(editingProject.system_prompt || '')
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
    }

    try {
      await dispatch(updateProject(payload)).unwrap()
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
  }

  const handleCancel = () => {
    resetForm()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className='fixed inset-0 bg-neutral-300/30 dark:bg-black/30 bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4 text-lg'>
      <div className='bg-neutral-100 text-neutral-900 dark:bg-yBlack-900 rounded-3xl border border-gray-200 dark:border-zinc-700 w-full max-w-4xl h-full max-h-[83vh] overflow-y-auto thin-scrollbar'>
        <div className='p-6'>
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
              <label className='block text-lg text-neutral-900 font-medium mb-2 dark:text-neutral-200'>
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
                minRows={19}
                maxRows={19}
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
