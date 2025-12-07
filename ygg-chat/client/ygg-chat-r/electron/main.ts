import { ChildProcess, spawn } from 'child_process'
import Conf from 'conf'
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import autoUpdaterPkg from 'electron-updater'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { startLocalServer, stopLocalServer } from './localServer.js'

// Destructure autoUpdater from CommonJS module (ESM/CJS interop)
const { autoUpdater } = autoUpdaterPkg

// ESM: Get __dirname from import.meta.url
const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null
let localServerStarted = false

// Custom protocol for OAuth callbacks
const PROTOCOL = 'yggchat'
const UPDATE_FEED_BASE_URL =
  process.env.SUPABASE_UPDATE_FEED_BASE_URL ||
  'https://awvlmkkdnwmpgomsuneb.supabase.co/storage/v1/object/public/updates/updates'
let autoUpdaterConfigured = false

// Set App User Model ID for Windows taskbar icon
if (process.platform === 'win32') {
  app.setAppUserModelId('com.yggdrasil.chat')
}

// Persistent storage for session data (initialized async)
let store: any = null
let storeInitialized = false

// In-memory fallback storage
const memoryStore = new Map<string, any>()

// Initialize conf (ESM module)
async function initializeStore() {
  try {
    const configDir = path.join(os.homedir(), '.config', 'ygg-chat-r')
    const configFile = path.join(configDir, 'config.json')

    // Check if config file exists and is corrupted
    if (fs.existsSync(configFile)) {
      try {
        const content = fs.readFileSync(configFile, 'utf-8')
        // Try to parse to validate JSON
        JSON.parse(content)
      } catch (parseError) {
        console.warn('[Electron] Config file corrupted, removing:', configFile)
        try {
          fs.unlinkSync(configFile)
        } catch (unlinkError) {
          console.warn('[Electron] Failed to remove corrupted config file:', unlinkError)
        }
      }
    }

    // Initialize conf (ESM library)
    store = new Conf({
      projectName: 'ygg-chat-r',
      configFileMode: 0o600,
    })
    storeInitialized = true
    console.log('[Electron] Storage initialized successfully (conf)')
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : ''
    console.error('[Electron] Failed to initialize conf storage')
    console.error('[Electron] Error message:', errorMsg)
    console.error('[Electron] Error stack:', errorStack)
    console.warn('[Electron] ⚠️  Using in-memory fallback storage')
    console.warn('[Electron] Note: Data will not persist after app restart')
    storeInitialized = true // Mark as initialized even with fallback
  }
}

// Helper functions for storage access with fallback
function getFromStore(key: string): any {
  if (!storeInitialized) {
    console.warn('[Electron] Store not yet initialized')
    return null
  }

  try {
    if (store) {
      return store.get(key)
    } else {
      // Use in-memory fallback
      return memoryStore.get(key) || null
    }
  } catch (error) {
    console.error('[Electron] Error reading from store:', error)
    return memoryStore.get(key) || null
  }
}

function setInStore(key: string, value: any): boolean {
  if (!storeInitialized) {
    console.warn('[Electron] Store not yet initialized')
    return false
  }

  try {
    if (store) {
      store.set(key, value)
      return true
    } else {
      // Use in-memory fallback
      memoryStore.set(key, value)
      return true
    }
  } catch (error) {
    console.error('[Electron] Error writing to store:', error)
    // Fallback to memory
    memoryStore.set(key, value)
    return false
  }
}

function deleteFromStore(key: string): boolean {
  if (!storeInitialized) {
    console.warn('[Electron] Store not yet initialized')
    return false
  }

  try {
    if (store) {
      store.delete(key)
      return true
    } else {
      memoryStore.delete(key)
      return true
    }
  } catch (error) {
    console.error('[Electron] Error deleting from store:', error)
    memoryStore.delete(key)
    return false
  }
}

function clearStore(): boolean {
  if (!storeInitialized) {
    console.warn('[Electron] Store not yet initialized')
    return false
  }

  try {
    if (store) {
      store.clear()
      return true
    } else {
      memoryStore.clear()
      return true
    }
  } catch (error) {
    console.error('[Electron] Error clearing store:', error)
    memoryStore.clear()
    return false
  }
}

// Start embedded Express server
function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    // In production, server is bundled separately
    // In development, it's running separately via npm run dev:electron
    // Use app.isPackaged for reliable detection (true when running from installer)
    const isDev = !app.isPackaged

    if (isDev) {
      console.log('[Electron] Development mode - assuming server is already running on port 3001')
      resolve()
      return
    }

    // Production: Start the bundled server
    const serverPath = path.join(process.resourcesPath, 'server', 'dist', 'server', 'src', 'index.js')

    console.log('[Electron] Starting embedded server from:', serverPath)

    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        VITE_ENVIRONMENT: 'electron',
        PORT: '3001',
        NODE_ENV: 'production',
      },
      stdio: 'inherit',
    })

    serverProcess.on('error', (err: Error) => {
      console.error('[Electron] Server failed to start:', err)
      reject(err)
    })

    serverProcess.on('exit', (code, signal) => {
      console.log(`[Electron] Server process exited with code ${code} and signal ${signal}`)
    })

    // Wait a bit for server to start
    setTimeout(() => {
      console.log('[Electron] Server should be ready')
      resolve()
    }, 2000)
  })
}

// Helper to get icon path based on theme
function getIconPath(isDark: boolean) {
  const logoFile = isDark ? 'logo-l-thick.png' : 'logo-d-thick.png'
  return app.isPackaged
    ? path.join(__dirname, '../dist-electron/img', logoFile)
    : path.join(__dirname, '../public/img', logoFile)
}

// function applyTitleBarTheme(win: BrowserWindow, isDark?: boolean) {
//   // Only apply overlay on Windows where it's supported and requested, AND ONLY IN PRODUCTION
//   if (process.platform === 'win32' && app.isPackaged) {
//     // Use provided isDark value, or fall back to system preference
//     const useDark = isDark !== undefined ? isDark : nativeTheme.shouldUseDarkColors
//     win.setTitleBarOverlay({
//       color: 'transparent',
//       symbolColor: useDark ? '#f2f4f7' : '#0f172a',
//       height: 35, // Ensure there is a grippable area
//     })
//   }

//   // Update Window Icon
//   const useDark = isDark !== undefined ? isDark : nativeTheme.shouldUseDarkColors
//   win.setIcon(getIconPath(useDark))
// }

// nativeTheme.on('updated', () => {
//   if (mainWindow) applyTitleBarTheme(mainWindow)
// })

function createWindow() {
  const iconPath = getIconPath(nativeTheme.shouldUseDarkColors)

  mainWindow = new BrowserWindow({
    title: 'Yggdrasil',
    icon: iconPath,
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    // Platform-specific title bar settings
    ...(process.platform === 'win32'
      ? {
        frame: false,
        titleBarOverlay: false,
      }
      : process.platform === 'darwin'
        ? {
          titleBarStyle: 'hidden', // Standard for macOS
        }
        : {
          titleBarStyle: 'default', // Native title bar for Linux (safest)
        }),
    show: false, // Don't show until ready
  })

  // applyTitleBarTheme(mainWindow)

  // Show window when ready to avoid flicker
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Load the app
  // Use app.isPackaged for reliable detection (true when running from installer)
  const isDev = !app.isPackaged

  if (!isDev) {
    mainWindow.setMenu(null) // removes File/Edit/View in production
    mainWindow.removeMenu() // defensive (older Electron versions)
  }

  if (isDev) {
    // Development: Load from Vite dev server
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // Production: Load from built files
    const indexPath = path.join(__dirname, '../dist-electron/index.html')
    console.log('[Electron] Production mode - loading from:', indexPath)

    // Add error listeners BEFORE loading
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error('[Electron] Failed to load:', { errorCode, errorDescription, validatedURL })
    })

    mainWindow.webContents.on('did-finish-load', () => {
      console.log('[Electron] Page finished loading')
    })

    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      // console.log('[Renderer Console]', { level, message, line, sourceId })
    })

    mainWindow.loadFile(indexPath)

    // DEBUG: Force DevTools to open after a delay
    // setTimeout(() => {
    //   console.log('[Electron] Force opening DevTools...')
    //   mainWindow?.webContents.openDevTools({ mode: 'detach' })
    // }, 3000)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Register protocol handler for OAuth callbacks
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Handle protocol on macOS
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleOAuthCallback(url)
})

// Handle protocol on Windows/Linux (via second instance)
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }

    // The commandLine is an array of strings in which the last element is the deep link url
    // On Windows/Linux, the protocol URL will be in the command line arguments
    const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`))
    if (url) {
      handleOAuthCallback(url)
    }
  })
}

// Handle OAuth callback from external browser
function handleOAuthCallback(url: string) {
  console.log('[Electron] Received OAuth callback:', url)

  // Send the callback URL to the renderer process
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('oauth:callback', url)

    // Focus the window
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}

// App lifecycle
app.whenReady().then(async () => {
  try {
    console.log('[Electron] App ready, initializing storage...')
    await initializeStore()
    console.log('[Electron] Storage initialized, starting server...')
    await startServer()
    console.log('[Electron] Server started, starting local sync server...')

    // Start local SQLite server for dual-sync (port 3002)
    try {
      const localDbPath = path.join(app.getPath('userData'), 'local-sync.db')
      await startLocalServer(3002, localDbPath)
      localServerStarted = true
      console.log('[Electron] Local sync server started on port 3002')
    } catch (localServerError) {
      console.warn('[Electron] Failed to start local sync server:', localServerError)
      console.warn('[Electron] Continuing without local sync - data will not be synced locally')
    }

    console.log('[Electron] Creating window...')
    createWindow()
    configureAutoUpdater()
  } catch (error) {
    console.error('[Electron] Failed to start:', error)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // Kill server when app closes
  if (serverProcess) {
    console.log('[Electron] Killing server process...')
    serverProcess.kill()
    serverProcess = null
  }

  // Stop local sync server
  if (localServerStarted) {
    console.log('[Electron] Stopping local sync server...')
    stopLocalServer().catch(err => console.error('[Electron] Error stopping local server:', err))
    localServerStarted = false
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  // Ensure server is killed
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }

  // Ensure local sync server is stopped
  if (localServerStarted) {
    stopLocalServer().catch(err => console.error('[Electron] Error stopping local server on quit:', err))
    localServerStarted = false
  }
})

// IPC Handlers for Electron-specific features

// Authentication (optional - for cloud sync)
ipcMain.handle('auth:login', async (_event, _credentials) => {
  // In Electron, we can store credentials securely using electron-store or keytar
  // For now, return a simple success
  console.log('[Electron IPC] auth:login called')
  return { success: true, userId: 'electron-user-id' }
})

ipcMain.handle('auth:logout', async () => {
  console.log('[Electron IPC] auth:logout called')
  // Clear stored credentials
  return { success: true }
})

// Storage - Persistent storage using electron-store with fallback
ipcMain.handle('storage:get', async (_event, key: string) => {
  console.log('[Electron IPC] storage:get called for key:', key)

  if (!storeInitialized) {
    console.error('[Electron IPC] Storage not initialized yet')
    return null
  }

  try {
    const value = getFromStore(key)
    console.log('[Electron IPC] Retrieved value:', value ? 'found' : 'not found')
    return value || null
  } catch (error) {
    console.error('[Electron IPC] Failed to get from storage:', error)
    return null
  }
})

ipcMain.handle('storage:set', async (_event, key: string, value: any) => {
  console.log('[Electron IPC] storage:set called for key:', key)

  if (!storeInitialized) {
    console.error('[Electron IPC] Storage not initialized yet')
    return { success: false, error: 'Storage not initialized' }
  }

  try {
    if (value === null || value === undefined) {
      // Delete key if value is null/undefined
      const success = deleteFromStore(key)
      console.log('[Electron IPC] Deleted key from storage')
      return { success }
    } else {
      const success = setInStore(key, value)
      console.log('[Electron IPC] Stored successfully')
      return { success }
    }
  } catch (error) {
    console.error('[Electron IPC] Failed to set storage:', error)
    return { success: false, error: String(error) }
  }
})

// Clear all storage (for logout/account switching)
ipcMain.handle('storage:clear', async () => {
  console.log('[Electron IPC] storage:clear called - clearing all stored data')

  if (!storeInitialized) {
    console.error('[Electron IPC] Storage not initialized yet')
    return { success: false, error: 'Storage not initialized' }
  }

  try {
    const success = clearStore()
    return { success }
  } catch (error) {
    console.error('[Electron IPC] Failed to clear storage:', error)
    return { success: false, error: String(error) }
  }
})

// Get platform info
ipcMain.handle('platform:info', async () => {
  return {
    platform: process.platform,
    version: app.getVersion(),
    isElectron: true,
  }
})

ipcMain.handle('autoUpdater:check', async () => {
  if (!autoUpdaterConfigured) {
    return { success: false, error: 'Auto-updater not configured' }
  }

  try {
    await autoUpdater.checkForUpdates()
    return { success: true }
  } catch (error) {
    console.error('[Electron] Manual update check failed:', error)
    return { success: false, error: String(error) }
  }
})

ipcMain.handle('autoUpdater:installNow', async () => {
  console.log('[Electron] User requested immediate update install')
  try {
    // quitAndInstall will close the app and run the installer
    autoUpdater.quitAndInstall(false, true) // isSilent=false, isForceRunAfter=true
    return { success: true }
  } catch (error) {
    console.error('[Electron] Failed to install update:', error)
    return { success: false, error: String(error) }
  }
})

// Open OAuth URL in external browser
ipcMain.handle('auth:openExternal', async (_event, url: string) => {
  console.log('[Electron IPC] Opening external URL for OAuth:', url)
  try {
    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    console.error('[Electron IPC] Failed to open external URL:', error)
    return { success: false, error: String(error) }
  }
})

// Open OAuth URL in a new BrowserWindow (for WSL/Linux compatibility)
ipcMain.handle('auth:openOAuthWindow', async (_event, url: string) => {
  console.log('[Electron IPC] Opening OAuth window:', url)

  return new Promise(resolve => {
    // Create a modal window for OAuth
    const oauthWindow = new BrowserWindow({
      width: 500,
      height: 700,
      modal: true,
      parent: mainWindow || undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
      title: 'Sign in',
      autoHideMenuBar: true,
    })

    // Load the OAuth URL
    oauthWindow.loadURL(url)

    // Handle navigation to callback URL
    const handleNavigation = (navigationUrl: string) => {
      console.log('[Electron OAuth] Navigation detected:', navigationUrl)

      // Check if this is our callback URL
      if (navigationUrl.startsWith(`${PROTOCOL}://`)) {
        console.log('[Electron OAuth] Callback URL detected, closing window')

        // Close the OAuth window
        oauthWindow.close()

        // Send the callback to handleOAuthCallback function
        handleOAuthCallback(navigationUrl)

        resolve({ success: true })
        return true
      }
      return false
    }

    // Listen for redirects (works for most OAuth providers)
    oauthWindow.webContents.on('will-redirect', (event, navigationUrl) => {
      if (handleNavigation(navigationUrl)) {
        event.preventDefault()
      }
    })

    // Listen for navigation (backup for providers that don't redirect)
    oauthWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      if (handleNavigation(navigationUrl)) {
        event.preventDefault()
      }
    })

    // Handle window close
    oauthWindow.on('closed', () => {
      console.log('[Electron OAuth] Window closed')
      resolve({ success: true })
    })

    // Handle errors
    oauthWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('[Electron OAuth] Failed to load:', errorCode, errorDescription)
      oauthWindow.close()
      resolve({ success: false, error: errorDescription })
    })
  })
})

// Local sync server status
ipcMain.handle('sync:status', async () => {
  return {
    localServerRunning: localServerStarted,
    localServerPort: 3002,
    localServerUrl: 'http://127.0.0.1:3002',
  }
})

// Window controls for custom title bar
ipcMain.handle('window:minimize', async () => {
  if (mainWindow) {
    mainWindow.minimize()
  }
})

ipcMain.handle('window:maximize', async () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  }
})

ipcMain.handle('window:close', async () => {
  if (mainWindow) {
    mainWindow.close()
  }
})

// Theme synchronization - disabled (titlebar is now transparent)
// Handler kept as no-op to prevent "No handler registered" errors
ipcMain.handle('theme:update', async () => {
  // No-op: theme sync disabled since titlebar is transparent
})

function configureAutoUpdater() {
  if (autoUpdaterConfigured) {
    return
  }

  if (!app.isPackaged) {
    console.log('[Electron] Auto-updater skipped: not packaged')
    return
  }

  if (!UPDATE_FEED_BASE_URL) {
    console.warn('[Electron] Auto-updater skipped: SUPABASE_UPDATE_FEED_BASE_URL missing')
    return
  }

  const platformDir = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'

  const normalizedBase = UPDATE_FEED_BASE_URL.replace(/\/+$/, '')
  const feedUrl = `${normalizedBase}/${platformDir}`

  try {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl,
    })
  } catch (error) {
    console.error('[Electron] Failed to set feed URL:', error)
    return
  }

  autoUpdaterConfigured = true

  autoUpdater.on('checking-for-update', () => {
    console.log('[Electron] Checking for updates...')
    mainWindow?.webContents.send('autoUpdater:checking')
  })

  autoUpdater.on('update-available', info => {
    console.log('[Electron] Update available:', info?.version)
    mainWindow?.webContents.send('autoUpdater:update-available', info)
  })

  autoUpdater.on('update-not-available', info => {
    console.log('[Electron] No updates available')
    mainWindow?.webContents.send('autoUpdater:update-not-available', info)
  })

  autoUpdater.on('download-progress', progressObj => {
    mainWindow?.webContents.send('autoUpdater:download-progress', progressObj)
  })

  autoUpdater.on('update-downloaded', info => {
    console.log('[Electron] Update downloaded, ready to install')
    mainWindow?.webContents.send('autoUpdater:update-downloaded', info)
    // Don't auto-install - let user choose via modal
  })

  autoUpdater.on('error', error => {
    console.error('[Electron] Auto-updater error:', error)
    mainWindow?.webContents.send('autoUpdater:error', error ? error.message || String(error) : 'Unknown error')
  })

  setTimeout(() => {
    autoUpdater
      .checkForUpdatesAndNotify()
      .then(result => {
        if (!result?.downloadPromise) {
          console.log('[Electron] No update download triggered')
        }
      })
      .catch(error => {
        console.error('[Electron] Failed to check for updates:', error)
      })
  }, 3000)
}
