import { createAsyncThunk } from '@reduxjs/toolkit'
import { Project } from '../../../../../shared/types'
import { apiCall } from '../../utils/api'
import { ThunkExtraArgument } from '../../store/thunkExtra'
import { RootState } from '../../store/store'
import { dualSync } from '../../lib/sync/dualSyncManager'

// Fetch all projects
export const fetchProjects = createAsyncThunk<Project[], void, { extra: ThunkExtraArgument }>(
  'projects/fetchProjects',
  async (_, { extra }) => {
    const { auth } = extra
    const response = await apiCall('/projects', auth.accessToken, {
      method: 'GET',
    })
    return response as Project[]
  }
)

// Fetch project by ID
export const fetchProjectById = createAsyncThunk<Project, number | string, { extra: ThunkExtraArgument }>(
  'projects/fetchProjectById',
  async (projectId, { extra }) => {
    const { auth } = extra
    const response = await apiCall(`/projects/${projectId}`, auth.accessToken, {
      method: 'GET',
    })
    return response as Project
  }
)

// Create project
export interface CreateProjectPayload {
  name: string
  conversation_id?: number | string
  context?: string
  system_prompt?: string
}

export const createProject = createAsyncThunk<Project, CreateProjectPayload, { extra: ThunkExtraArgument; state: RootState }>(
  'projects/createProject',
  async (payload, { extra }) => {
    const { auth } = extra
    const response = await apiCall('/projects', auth.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        userId: auth.userId,
      }),
    })
    const project = response as Project

    // Sync to local SQLite (fire-and-forget)
    dualSync.syncProject({
      ...project,
      user_id: auth.userId,
    })

    return project
  }
)

// Update project
export interface UpdateProjectPayload {
  id: number | string
  name: string
  context?: string
  system_prompt?: string
}

export const updateProject = createAsyncThunk<Project, UpdateProjectPayload, { extra: ThunkExtraArgument }>(
  'projects/updateProject',
  async (payload, { extra }) => {
    const { auth } = extra
    const { id, ...updateData } = payload
    const response = await apiCall(`/projects/${id}`, auth.accessToken, {
      method: 'PUT',
      body: JSON.stringify(updateData),
    })
    const project = response as Project

    // Sync to local SQLite (fire-and-forget)
    dualSync.syncProject(project, 'update')

    return project
  }
)

// Delete project
export const deleteProject = createAsyncThunk<number | string, number | string, { extra: ThunkExtraArgument }>(
  'projects/deleteProject',
  async (projectId, { extra }) => {
    const { auth } = extra
    await apiCall(`/projects/${projectId}`, auth.accessToken, {
      method: 'DELETE',
    })

    // Sync deletion to local SQLite (fire-and-forget)
    dualSync.syncProject({ id: projectId }, 'delete')

    return projectId
  }
)
