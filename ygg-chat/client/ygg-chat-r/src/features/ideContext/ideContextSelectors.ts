// features/ideContext/ideContextSelectors.ts
import { createSelector } from '@reduxjs/toolkit'
import { RootState } from '../../store/store'

export const selectIdeContext = (state: RootState) => state.ideContext

export const selectIsIdeConnected = (state: RootState) => state.ideContext.isConnected

export const selectWorkspace = (state: RootState) => state.ideContext.workspace
export const selectExtensions = (state: RootState) => state.ideContext.extensions
export const selectSelectedExtensionId = (state: RootState) => state.ideContext.selectedExtensionId

export const selectOpenFiles = (state: RootState) => state.ideContext.openFiles

export const selectActiveFile = (state: RootState) => state.ideContext.activeFile

export const selectCurrentSelection = (state: RootState) => state.ideContext.currentSelection

export const selectAllFiles = (state: RootState) => state.ideContext.allFiles

const normalizeSlashes = (value: string) => value.replace(/\\/g, '/')
const basename = (value: string) => {
  const normalized = normalizeSlashes(value)
  const parts = normalized.split('/')
  return parts[parts.length - 1] || normalized
}

const dirname = (value: string) => {
  const normalized = normalizeSlashes(value)
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return ''
  return normalized.slice(0, idx)
}

const trimTrailingSlash = (value: string) => normalizeSlashes(value).replace(/\/+$/, '')

function toRelativePath(filePath: string, workspaceRoot: string | null | undefined, workspaceName: string | null | undefined): string {
  const normalizedPath = normalizeSlashes(filePath)

  if (workspaceRoot) {
    const normalizedRoot = trimTrailingSlash(workspaceRoot)
    const lowerPath = normalizedPath.toLowerCase()
    const lowerRoot = normalizedRoot.toLowerCase()

    if (lowerPath === lowerRoot) {
      return basename(normalizedPath)
    }

    if (lowerPath.startsWith(`${lowerRoot}/`)) {
      return normalizedPath.slice(normalizedRoot.length + 1)
    }
  }

  if (workspaceName) {
    const parts = normalizedPath.split('/')
    const workspaceIndex = parts.findIndex(part => part === workspaceName)
    if (workspaceIndex !== -1 && workspaceIndex < parts.length - 1) {
      return parts.slice(workspaceIndex + 1).join('/')
    }
  }

  return normalizedPath
}

export type MentionableEntryKind = 'file' | 'folder'

export interface MentionableFileOption {
  kind: MentionableEntryKind
  path: string
  relativePath: string
  directoryPath: string
  relativeDirectoryPath: string
  name: string
  mention: string
}

export const selectMentionableFiles = createSelector([selectAllFiles, selectWorkspace], (allFiles, workspace): MentionableFileOption[] => {
  const normalizedWorkspaceRoot = workspace?.rootPath ? trimTrailingSlash(workspace.rootPath) : ''

  const fileOptions: MentionableFileOption[] = allFiles.map(path => {
    const relativePath = toRelativePath(path, workspace?.rootPath, workspace?.name)
    const name = basename(relativePath)
    return {
      kind: 'file',
      path,
      relativePath,
      directoryPath: dirname(path),
      relativeDirectoryPath: dirname(relativePath),
      name,
      mention: `@${relativePath || name}`,
    }
  })

  const folderMap = new Map<string, MentionableFileOption>()

  for (const file of fileOptions) {
    const relativeSegments = normalizeSlashes(file.relativePath)
      .split('/')
      .filter(Boolean)

    // Build all ancestor folders (e.g. src, src/components, src/components/ui)
    for (let segmentCount = 1; segmentCount < relativeSegments.length; segmentCount++) {
      const folderRelativePath = relativeSegments.slice(0, segmentCount).join('/')
      if (folderMap.has(folderRelativePath)) continue

      const folderParentRelativePath = dirname(folderRelativePath)
      const folderAbsolutePath = normalizedWorkspaceRoot
        ? `${normalizedWorkspaceRoot}/${folderRelativePath}`
        : folderRelativePath
      const folderParentAbsolutePath = normalizedWorkspaceRoot
        ? folderParentRelativePath
          ? `${normalizedWorkspaceRoot}/${folderParentRelativePath}`
          : normalizedWorkspaceRoot
        : folderParentRelativePath

      folderMap.set(folderRelativePath, {
        kind: 'folder',
        path: folderAbsolutePath,
        relativePath: folderRelativePath,
        directoryPath: folderParentAbsolutePath,
        relativeDirectoryPath: folderParentRelativePath,
        name: basename(folderRelativePath),
        mention: `@${folderRelativePath}`,
      })
    }
  }

  const folderOptions = Array.from(folderMap.values())

  return [...folderOptions, ...fileOptions].sort((a, b) => {
    const byPath = a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base' })
    if (byPath !== 0) return byPath
    if (a.kind === b.kind) return 0
    return a.kind === 'folder' ? -1 : 1
  })
})

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
  extensions: state.ideContext.extensions,
  selectedExtensionId: state.ideContext.selectedExtensionId,
})
