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
  shell: {
    openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  },
  titleBar: {
    setOverlay: (payload: { color?: string; symbolColor?: string; height?: number }) =>
      ipcRenderer.invoke('titlebar:set-overlay', payload),
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
