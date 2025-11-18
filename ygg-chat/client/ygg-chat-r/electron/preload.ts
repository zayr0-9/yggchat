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
  platform: 'electron',
})

// Log that preload script has loaded
console.log('[Electron Preload] Script loaded, electronAPI exposed')
