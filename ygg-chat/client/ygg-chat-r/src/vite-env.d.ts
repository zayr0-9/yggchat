/// <reference types="vite/client" />

// Build-time constants defined in vite.config.ts
declare const __BUILD_TARGET__: 'web' | 'electron' | 'local'
declare const __IS_ELECTRON__: boolean
declare const __IS_WEB__: boolean
declare const __IS_LOCAL__: boolean

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_ENVIRONMENT?: 'web' | 'local' | 'electron'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Electron API types (available when running in Electron)
interface ElectronAPI {
  auth: {
    login: (credentials: any) => Promise<any>
    logout: () => Promise<void>
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>
    openOAuthWindow: (url: string) => Promise<{ success: boolean; error?: string }>
    onOAuthCallback: (callback: (url: string) => void) => () => void
  }
  storage: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any) => Promise<void>
    clear: () => Promise<{ success: boolean; error?: string }>
  }
  platformInfo: {
    get: () => Promise<{ platform: string; version: string; isElectron: boolean }>
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    openFloating: () => Promise<{ success: boolean; error?: string }>
    closeFloating: () => Promise<{ success: boolean; error?: string }>
    toggleFloating: () => Promise<{ success: boolean; error?: string; isOpen: boolean }>
    isFloatingOpen: () => Promise<boolean>
    toggleCompact: () => Promise<{ success: boolean; error?: string; compact: boolean }>
    isCompact: () => Promise<boolean>
  }
  theme: {
    update: (themePreference: boolean | 'light' | 'dark' | 'system') => Promise<void>
  }
  sync: {
    status: () => Promise<{
      localServerRunning: boolean
      localServerPort: number | null
      localServerUrl: string | null
      localServerLanUrl?: string | null
      localServerError?: string | null
    }>
  }
  shell: {
    openPath: (path: string) => Promise<{ success: boolean; error?: string }>
  }
  logs: {
    appendClientError: (content: string) => Promise<{ success: boolean; error?: string; filePath?: string }>
    getClientErrorLogPath: () => Promise<{ success: boolean; error?: string; filePath?: string }>
  }
  dialog: {
    selectFolder: () => Promise<{ success: boolean; path?: string; error?: string }>
  }
  autoUpdater: {
    check: () => Promise<{ success: boolean; error?: string }>
    installNow: () => Promise<{ success: boolean; error?: string }>
    onChecking: (callback: () => void) => () => void
    onUpdateAvailable: (callback: (info: { version: string }) => void) => () => void
    onUpdateNotAvailable: (callback: (info: any) => void) => () => void
    onDownloadProgress: (
      callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void
    ) => () => void
    onUpdateDownloaded: (callback: (info: { version: string }) => void) => () => void
    onError: (callback: (error: string) => void) => () => void
  }
  customTool: {
    execute: (
      toolPath: string,
      args?: Record<string, any>
    ) => Promise<{ success: boolean; result?: any; error?: string }>
    clearCache: (toolPath?: string) => Promise<{ success: boolean; cleared?: number; error?: string }>
  }
  platform: 'electron'
}

interface Window {
  electronAPI?: ElectronAPI
}
