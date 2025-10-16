import { createSelector } from '@reduxjs/toolkit'
import { RootState } from '../../store/store'
import { ProjectState } from './projectTypes'
import { ProjectId } from '../../../../../shared/types'

// Base selector
const selectProjectsState = (state: RootState): ProjectState => state.projects

// Memoized selectors
export const selectAllProjects = createSelector(
  [selectProjectsState],
  (projectsState) => projectsState.projects
)

export const selectProjectsLoading = createSelector(
  [selectProjectsState],
  (projectsState) => projectsState.loading
)

export const selectProjectsError = createSelector(
  [selectProjectsState],
  (projectsState) => projectsState.error
)

export const selectSelectedProject = createSelector(
  [selectProjectsState],
  (projectsState) => projectsState.selectedProject
)

// Derived selectors
export const selectProjectById = createSelector(
  [selectAllProjects, (_state: RootState, projectId: ProjectId) => projectId],
  (projects, projectId) => projects.find(project => project.id === projectId)
)

export const selectProjectsByName = createSelector(
  [selectAllProjects, (_state: RootState, searchTerm: string) => searchTerm],
  (projects, searchTerm) => 
    projects.filter(project => 
      project.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
)

export const selectProjectsCount = createSelector(
  [selectAllProjects],
  (projects) => projects.length
)

export const selectHasProjects = createSelector(
  [selectAllProjects],
  (projects) => projects.length > 0
)
