import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Project } from '../../../../../shared/types'
import { ProjectState } from './projectTypes'
import {
  fetchProjects,
  fetchProjectById,
  createProject,
  updateProject,
  deleteProject,
} from './projectActions'

const initialState: ProjectState = {
  projects: [],
  loading: false,
  error: null,
  selectedProject: null,
}

const projectSlice = createSlice({
  name: 'projects',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
    clearSelectedProject: (state) => {
      state.selectedProject = null
    },
    setSelectedProject: (state, action: PayloadAction<Project>) => {
      state.selectedProject = action.payload
    },
    // Sync projects from React Query to Redux
    projectsLoaded: (state, action: PayloadAction<Project[]>) => {
      state.projects = action.payload
    },
  },
  extraReducers: (builder) => {
    // Fetch all projects
    builder
      .addCase(fetchProjects.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchProjects.fulfilled, (state, action) => {
        state.loading = false
        state.projects = action.payload
      })
      .addCase(fetchProjects.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to fetch projects'
      })

    // Fetch project by ID
    builder
      .addCase(fetchProjectById.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchProjectById.fulfilled, (state, action) => {
        state.loading = false
        state.selectedProject = action.payload
      })
      .addCase(fetchProjectById.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to fetch project'
      })

    // Create project
    builder
      .addCase(createProject.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(createProject.fulfilled, (state, action) => {
        state.loading = false
        state.projects.push(action.payload)
        state.selectedProject = action.payload
      })
      .addCase(createProject.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to create project'
      })

    // Update project
    builder
      .addCase(updateProject.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(updateProject.fulfilled, (state, action) => {
        state.loading = false
        const index = state.projects.findIndex(p => p.id === action.payload.id)
        if (index !== -1) {
          state.projects[index] = action.payload
        }
        if (state.selectedProject?.id === action.payload.id) {
          state.selectedProject = action.payload
        }
      })
      .addCase(updateProject.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to update project'
      })

    // Delete project
    builder
      .addCase(deleteProject.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(deleteProject.fulfilled, (state, action) => {
        state.loading = false
        state.projects = state.projects.filter(p => p.id !== action.meta.arg)
        if (state.selectedProject?.id === action.meta.arg) {
          state.selectedProject = null
        }
      })
      .addCase(deleteProject.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to delete project'
      })
  },
})

export const { clearError, clearSelectedProject, setSelectedProject, projectsLoaded } = projectSlice.actions
export default projectSlice.reducer
