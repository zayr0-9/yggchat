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
  }
  theme: {
    update: (isDark: boolean) => Promise<void>
  }
  platform: 'electron'
}

interface Window {
  electronAPI?: ElectronAPI
}
