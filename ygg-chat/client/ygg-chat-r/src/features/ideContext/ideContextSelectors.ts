// features/ideContext/ideContextSelectors.ts
import { createSelector } from '@reduxjs/toolkit'
import { RootState } from '../../store/store'

export const selectIdeContext = (state: RootState) => state.ideContext

export const selectIsIdeConnected = (state: RootState) => state.ideContext.isConnected

export const selectWorkspace = (state: RootState) => state.ideContext.workspace

export const selectOpenFiles = (state: RootState) => state.ideContext.openFiles

export const selectActiveFile = (state: RootState) => state.ideContext.activeFile

export const selectCurrentSelection = (state: RootState) => state.ideContext.currentSelection

export const selectAllFiles = (state: RootState) => state.ideContext.allFiles

export const selectMentionableFiles = createSelector([selectAllFiles], allFiles =>
  allFiles.map(path => ({
    path,
    name: path.split(/[\\/]/).pop() || path,
    mention: `@${path}`,
  }))
)

export const selectRecentActivity = (state: RootState) => state.ideContext.recentActivity

export const selectSelectedFilesForChat = (state: RootState) => state.ideContext.selectedFilesForChat

export const selectContextSummary = (state: RootState) => ({
  isConnected: state.ideContext.isConnected,
  workspace: state.ideContext.workspace?.name,
  openFiles: state.ideContext.openFiles.length,
  activeFile: state.ideContext.activeFile?.name,
  hasSelection: !!state.ideContext.currentSelection,
  totalFiles: state.ideContext.allFiles.length,
  lastUpdated: state.ideContext.lastUpdated,
})
