// IDE Context Types
export interface FileInfo {
  path: string
  relativePath: string
  directoryPath?: string
  relativeDirectoryPath?: string
  name: string
  language: string
  lastModified: string
  lineCount?: number
  size?: number
}

export interface SelectionInfo {
  filePath: string
  relativePath: string
  selectedText: string
  startLine: number
  endLine: number
  startChar: number
  endChar: number
  timestamp: string
}

export interface WorkspaceInfo {
  name: string | null
  rootPath: string | null
  totalFiles: number
  lastScanned: string
}

export interface SelectedFileContent {
  path: string
  relativePath: string
  directoryPath?: string
  relativeDirectoryPath?: string
  name?: string
  contents: string
  contentLength: number
  requestId?: number
}

export interface ExtensionInfo {
  id: string
  workspaceName: string | null
  rootPath: string | null
  lastHeartbeat: number
  connectedAt: number
  isConnected: boolean
}

export interface IdeContext {
  // Connection status
  isConnected: boolean
  extensionConnected: boolean
  lastUpdated: string
  selectedFilesForChat: SelectedFileContent[]

  // Workspace information (active selection)
  workspace: WorkspaceInfo | null

  // File tracking (active selection)
  openFiles: FileInfo[]
  activeFile: FileInfo | null
  allFiles: string[] // For @mention functionality

  // Selection tracking (active selection)
  currentSelection: SelectionInfo | null

  // Recent activity (for context awareness)
  recentActivity: {
    type: 'file_opened' | 'file_closed' | 'selection_changed' | 'file_edited'
    timestamp: string
    filePath: string
    details?: any
  }[]

  // Multi-extension support
  extensions: ExtensionInfo[]
  selectedExtensionId: string | null
}
