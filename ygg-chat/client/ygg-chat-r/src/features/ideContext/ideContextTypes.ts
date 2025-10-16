// IDE Context Types
export interface FileInfo {
  path: string
  relativePath: string
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
  totalFiles: number
  lastScanned: string
}

export interface SelectedFileContent {
  path: string
  relativePath: string
  name?: string
  contents: string
  contentLength: number
  requestId?: number
}

export interface IdeContext {
  // Connection status
  isConnected: boolean
  extensionConnected: boolean
  lastUpdated: string
  selectedFilesForChat: SelectedFileContent[]

  // Workspace information
  workspace: WorkspaceInfo | null

  // File tracking
  openFiles: FileInfo[]
  activeFile: FileInfo | null
  allFiles: string[] // For @mention functionality

  // Selection tracking
  currentSelection: SelectionInfo | null

  // Recent activity (for context awareness)
  recentActivity: {
    type: 'file_opened' | 'file_closed' | 'selection_changed' | 'file_edited'
    timestamp: string
    filePath: string
    details?: any
  }[]
}
