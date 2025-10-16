import { Project } from '../../../../../shared/types'

export interface ProjectState {
  projects: Project[]
  loading: boolean
  error: string | null
  selectedProject: Project | null
}
