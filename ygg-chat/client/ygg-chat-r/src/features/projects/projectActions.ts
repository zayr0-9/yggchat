import { createAsyncThunk } from '@reduxjs/toolkit'
import { Project, StorageMode } from '../../../../../shared/types'
import { apiCall, localApi, environment, shouldUseLocalApi } from '../../utils/api'
import { ThunkExtraArgument } from '../../store/thunkExtra'
import { RootState } from '../../store/store'
import { dualSync } from '../../lib/sync/dualSyncManager'

// Fetch all projects
export const fetchProjects = createAsyncThunk<Project[], void, { extra: ThunkExtraArgument }>(
  'projects/fetchProjects',
  async (_, { extra }) => {
    const { auth } = extra

    // In Electron mode, fetch both cloud and local projects
    if (environment === 'electron') {
      const [cloudProjects, localProjects] = await Promise.all([
        apiCall('/projects', auth.accessToken, { method: 'GET' }) as Promise<Project[]>,
        localApi.get<Project[]>(`/local/projects?userId=${auth.userId}`)
      ])

      // Merge and sort by updated_at
      const merged = [...cloudProjects, ...localProjects]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

      return merged
    }

    // Web mode: cloud only
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
  storageMode?: StorageMode // NEW PARAMETER
}

export const createProject = createAsyncThunk<Project, CreateProjectPayload, { extra: ThunkExtraArgument; state: RootState }>(
  'projects/createProject',
  async (payload, { extra }) => {
    const { auth } = extra
    const { storageMode, ...restPayload } = payload

    const effectiveStorageMode = storageMode || 'cloud'

    // Route to local or cloud API
    if (shouldUseLocalApi(effectiveStorageMode, environment)) {
      const project = await localApi.post<Project>('/local/projects', {
        user_id: auth.userId,
        name: restPayload.name,
        context: restPayload.context || null,
        system_prompt: restPayload.system_prompt || null,
        storage_mode: 'local'
      })
      return project
    }

    // Cloud mode: existing behavior
    const response = await apiCall('/projects', auth.accessToken, {
      method: 'POST',
      body: JSON.stringify({
        ...restPayload,
        userId: auth.userId,
      }),
    })
    const project = response as Project

    // Sync to local SQLite (fire-and-forget) - only for cloud mode
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
  storage_mode?: StorageMode
}

export const updateProject = createAsyncThunk<Project, UpdateProjectPayload, { extra: ThunkExtraArgument; state: RootState }>(
  'projects/updateProject',
  async (payload, { extra, getState }) => {
    const { auth } = extra
    const { id, storage_mode, ...updateData } = payload

    // Infer storage mode from state if not provided
    let effectiveMode = storage_mode
    if (!effectiveMode) {
      const project = getState().projects.projects.find(p => p.id === id)
      effectiveMode = project?.storage_mode || 'cloud'
    }

    // Route to local or cloud API
    if (shouldUseLocalApi(effectiveMode, environment)) {
      const project = await localApi.patch<Project>(`/local/projects/${id}`, {
        name: updateData.name,
        context: updateData.context || null,
        system_prompt: updateData.system_prompt || null,
        storage_mode: effectiveMode
      })
      return project
    }

    // Cloud mode: existing behavior
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
export const deleteProject = createAsyncThunk<
  number | string,
  { id: number | string; storageMode?: StorageMode },
  { extra: ThunkExtraArgument; state: RootState }
>(
  'projects/deleteProject',
  async ({ id: projectId, storageMode }, { extra, getState }) => {
    const { auth } = extra

    // Infer storage mode from state if not provided
    let effectiveMode = storageMode
    if (!effectiveMode) {
      const project = getState().projects.projects.find(p => p.id === projectId)
      effectiveMode = project?.storage_mode || 'cloud'
    }

    if (shouldUseLocalApi(effectiveMode, environment)) {
      await localApi.delete(`/local/projects/${projectId}`)
    } else {
      await apiCall(`/projects/${projectId}`, auth.accessToken, {
        method: 'DELETE',
      })

      // Sync deletion to local SQLite (fire-and-forget)
      dualSync.syncProject({ id: projectId }, 'delete')
    }

    return projectId
  }
)
