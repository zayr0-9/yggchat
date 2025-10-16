// features/ideContext/ideContextSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { FileInfo, IdeContext, SelectionInfo, WorkspaceInfo, SelectedFileContent } from './ideContextTypes'
import { chatSliceActions } from '../chats/chatSlice'

// Initial state
export const ideContextInitialState: IdeContext = {
  isConnected: false,
  extensionConnected: false,
  lastUpdated: '',
  workspace: null,
  openFiles: [],
  activeFile: null,
  allFiles: [],
  selectedFilesForChat: [],
  currentSelection: null,
  recentActivity: [],
}

const ideContextSlice = createSlice({
  name: 'ideContext',
  initialState: ideContextInitialState,
  reducers: {
    // Connection management
    setConnectionStatus: (state, action: PayloadAction<boolean>) => {
      state.isConnected = action.payload
      state.lastUpdated = new Date().toISOString()
    },

    setExtensionStatus: (state, action: PayloadAction<boolean>) => {
      state.extensionConnected = action.payload
      state.lastUpdated = new Date().toISOString()
    },

    // Workspace updates
    updateWorkspace: (state, action: PayloadAction<WorkspaceInfo>) => {
      state.workspace = action.payload
      state.lastUpdated = new Date().toISOString()
    },

    // File management
    setOpenFiles: (state, action: PayloadAction<FileInfo[]>) => {
      state.openFiles = action.payload
      state.lastUpdated = new Date().toISOString()
    },

    addOpenFile: (state, action: PayloadAction<FileInfo>) => {
      const existingIndex = state.openFiles.findIndex(f => f.path === action.payload.path)

      if (existingIndex === -1) {
        state.openFiles.push(action.payload)
      } else {
        state.openFiles[existingIndex] = action.payload
      }

      state.lastUpdated = new Date().toISOString()

      // Add to recent activity
      state.recentActivity.unshift({
        type: 'file_opened',
        timestamp: new Date().toISOString(),
        filePath: action.payload.relativePath,
        details: { language: action.payload.language },
      })

      // Keep only last 20 activities
      state.recentActivity = state.recentActivity.slice(0, 20)
    },

    removeOpenFile: (state, action: PayloadAction<string>) => {
      const fileToRemove = state.openFiles.find(f => f.path === action.payload)
      state.openFiles = state.openFiles.filter(f => f.path !== action.payload)

      // Clear active file if it was closed
      if (state.activeFile?.path === action.payload) {
        state.activeFile = null
      }

      // Clear selection if it was in the closed file
      if (state.currentSelection?.filePath === action.payload) {
        state.currentSelection = null
      }

      state.lastUpdated = new Date().toISOString()

      if (fileToRemove) {
        state.recentActivity.unshift({
          type: 'file_closed',
          timestamp: new Date().toISOString(),
          filePath: fileToRemove.relativePath,
        })
        state.recentActivity = state.recentActivity.slice(0, 20)
      }
    },

    setActiveFile: (state, action: PayloadAction<FileInfo | null>) => {
      state.activeFile = action.payload
      state.lastUpdated = new Date().toISOString()
    },

    setAllFiles: (state, action: PayloadAction<string[]>) => {
      state.allFiles = action.payload
      state.lastUpdated = new Date().toISOString()
    },

    addSelectedFileForChat: (state, action: PayloadAction<SelectedFileContent>) => {
      const existingIndex = state.selectedFilesForChat.findIndex(f => f.path === action.payload.path)

      if (existingIndex === -1) {
        state.selectedFilesForChat.push(action.payload)
      } else {
        state.selectedFilesForChat[existingIndex] = action.payload
      }

      // Ensure no duplicates by path (keep the most recent entry)
      const seen = new Set<string>()
      state.selectedFilesForChat = state.selectedFilesForChat
        .slice()
        .reverse()
        .filter(f => {
          if (seen.has(f.path)) return false
          seen.add(f.path)
          return true
        })
        .reverse()

      state.lastUpdated = new Date().toISOString()
    },

    removeSelectedFileForChat: (state, action: PayloadAction<string>) => {
      state.selectedFilesForChat = state.selectedFilesForChat.filter(f => f.path !== action.payload)
      state.lastUpdated = new Date().toISOString()
    },

    addFile: (state, action: PayloadAction<string>) => {
      if (!state.allFiles.includes(action.payload)) {
        state.allFiles.push(action.payload)
        state.allFiles.sort()
      }

      if (state.workspace) {
        state.workspace.totalFiles = state.allFiles.length
      }

      state.lastUpdated = new Date().toISOString()
    },

    removeFile: (state, action: PayloadAction<string>) => {
      state.allFiles = state.allFiles.filter(f => f !== action.payload)

      if (state.workspace) {
        state.workspace.totalFiles = state.allFiles.length
      }

      state.lastUpdated = new Date().toISOString()
    },

    // Selection management
    setCurrentSelection: (state, action: PayloadAction<SelectionInfo | null>) => {
      state.currentSelection = action.payload
      state.lastUpdated = new Date().toISOString()

      if (action.payload) {
        state.recentActivity.unshift({
          type: 'selection_changed',
          timestamp: new Date().toISOString(),
          filePath: action.payload.relativePath,
          details: {
            selectedLength: action.payload.selectedText.length,
            lines: `${action.payload.startLine}-${action.payload.endLine}`,
          },
        })
        state.recentActivity = state.recentActivity.slice(0, 20)
      }
    },

    // Batch update from extension
    updateIdeContext: (state, action: PayloadAction<Partial<IdeContext>>) => {
      Object.assign(state, action.payload)
      state.lastUpdated = new Date().toISOString()
    },

    // Reset context (on workspace change)
    resetIdeContext: () => {
      return { ...ideContextInitialState }
    },
  },
  extraReducers: builder => {
    builder.addCase(chatSliceActions.sendingCompleted, state => {
      state.selectedFilesForChat = []
      state.lastUpdated = new Date().toISOString()
    })
  },
})

export const {
  setConnectionStatus,
  setExtensionStatus,
  updateWorkspace,
  setOpenFiles,
  addOpenFile,
  removeOpenFile,
  setActiveFile,
  setAllFiles,
  addSelectedFileForChat,
  removeSelectedFileForChat,
  addFile,
  removeFile,
  setCurrentSelection,
  updateIdeContext,
  resetIdeContext,
} = ideContextSlice.actions

export default ideContextSlice.reducer

