import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  auth: {
    login: (credentials: any) => ipcRenderer.invoke('auth:login', credentials),
    logout: () => ipcRenderer.invoke('auth:logout'),
    openExternal: (url: string) => ipcRenderer.invoke('auth:openExternal', url),
    openOAuthWindow: (url: string) => ipcRenderer.invoke('auth:openOAuthWindow', url),
    onOAuthCallback: (callback: (url: string) => void) => {
      const listener = (_event: any, url: string) => callback(url)
      ipcRenderer.on('oauth:callback', listener)
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('oauth:callback', listener)
      }
    },
  },
  storage: {
    get: (key: string) => ipcRenderer.invoke('storage:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('storage:set', key, value),
    clear: () => ipcRenderer.invoke('storage:clear'),
  },
  platformInfo: {
    get: () => ipcRenderer.invoke('platform:info'),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    // Floating window controls
    openFloating: () => ipcRenderer.invoke('window:openFloating'),
    closeFloating: () => ipcRenderer.invoke('window:closeFloating'),
    toggleFloating: () => ipcRenderer.invoke('window:toggleFloating'),
    isFloatingOpen: () => ipcRenderer.invoke('window:isFloatingOpen'),
    // Compact mode controls
    toggleCompact: () => ipcRenderer.invoke('window:toggleCompact'),
    isCompact: () => ipcRenderer.invoke('window:isCompact'),
  },
  theme: {
    update: (isDark: boolean) => ipcRenderer.invoke('theme:update', isDark),
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
  },
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  },
  dialog: {
    openFile: (options?: {
      title?: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
      properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
    }) => ipcRenderer.invoke('dialog:openFile', options),
    saveFile: (options?: {
      title?: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }) => ipcRenderer.invoke('dialog:saveFile', options),
    selectFolder: (options?: { title?: string; defaultPath?: string }) =>
      ipcRenderer.invoke('dialog:selectFolder', options),
  },
  fs: {
    readFile: (filePath: string, encoding?: BufferEncoding) => ipcRenderer.invoke('fs:readFile', filePath, encoding),
    writeFile: (filePath: string, content: string, encoding?: BufferEncoding) =>
      ipcRenderer.invoke('fs:writeFile', filePath, content, encoding),
    mkdir: (dirPath: string) => ipcRenderer.invoke('fs:mkdir', dirPath),
    stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
    readFileStream: (
      filePath: string,
      options?: {
        encoding?: BufferEncoding
        highWaterMark?: number
      }
    ) => ipcRenderer.invoke('fs:readFileStream', filePath, options),
    abortReadFileStream: (streamId: string) => ipcRenderer.invoke('fs:abortReadFileStream', streamId),
    onReadFileStreamChunk: (callback: (payload: any) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('fs:readFileStream:chunk', listener)
      return () => ipcRenderer.removeListener('fs:readFileStream:chunk', listener)
    },
    onReadFileStreamProgress: (callback: (payload: any) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('fs:readFileStream:progress', listener)
      return () => ipcRenderer.removeListener('fs:readFileStream:progress', listener)
    },
    onReadFileStreamEnd: (callback: (payload: any) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('fs:readFileStream:end', listener)
      return () => ipcRenderer.removeListener('fs:readFileStream:end', listener)
    },
    onReadFileStreamError: (callback: (payload: any) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('fs:readFileStream:error', listener)
      return () => ipcRenderer.removeListener('fs:readFileStream:error', listener)
    },
    onReadFileStreamAborted: (callback: (payload: any) => void) => {
      const listener = (_event: any, payload: any) => callback(payload)
      ipcRenderer.on('fs:readFileStream:aborted', listener)
      return () => ipcRenderer.removeListener('fs:readFileStream:aborted', listener)
    },
  },
  exec: {
    run: (command: string, options?: { cwd?: string; timeout?: number }) =>
      ipcRenderer.invoke('shell:exec', command, options),
  },
  http: {
    request: (options: {
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
      timeout?: number
    }) => ipcRenderer.invoke('http:request', options),
  },
  titleBar: {
    setOverlay: (payload: { color?: string; symbolColor?: string; height?: number }) =>
      ipcRenderer.invoke('titlebar:set-overlay', payload),
  },
  customTool: {
    execute: (toolPath: string, args?: Record<string, any>) =>
      ipcRenderer.invoke('customTool:execute', toolPath, args),
    clearCache: (toolPath?: string) => ipcRenderer.invoke('customTool:clearCache', toolPath),
  },
  autoUpdater: {
    check: () => ipcRenderer.invoke('autoUpdater:check'),
    installNow: () => ipcRenderer.invoke('autoUpdater:installNow'),
    onChecking: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('autoUpdater:checking', listener)
      return () => ipcRenderer.removeListener('autoUpdater:checking', listener)
    },
    onUpdateAvailable: (callback: (info: any) => void) => {
      const listener = (_event: any, info: any) => callback(info)
      ipcRenderer.on('autoUpdater:update-available', listener)
      return () => ipcRenderer.removeListener('autoUpdater:update-available', listener)
    },
    onUpdateNotAvailable: (callback: (info: any) => void) => {
      const listener = (_event: any, info: any) => callback(info)
      ipcRenderer.on('autoUpdater:update-not-available', listener)
      return () => ipcRenderer.removeListener('autoUpdater:update-not-available', listener)
    },
    onDownloadProgress: (callback: (progress: any) => void) => {
      const listener = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on('autoUpdater:download-progress', listener)
      return () => ipcRenderer.removeListener('autoUpdater:download-progress', listener)
    },
    onUpdateDownloaded: (callback: (info: any) => void) => {
      const listener = (_event: any, info: any) => callback(info)
      ipcRenderer.on('autoUpdater:update-downloaded', listener)
      return () => ipcRenderer.removeListener('autoUpdater:update-downloaded', listener)
    },
    onError: (callback: (error: string) => void) => {
      const listener = (_event: any, error: string) => callback(error)
      ipcRenderer.on('autoUpdater:error', listener)
      return () => ipcRenderer.removeListener('autoUpdater:error', listener)
    },
  },
  platform: 'electron',
})

// Log that preload script has loaded
console.log('[Electron Preload] Script loaded, electronAPI exposed')
