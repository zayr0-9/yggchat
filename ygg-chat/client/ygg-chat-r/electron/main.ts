import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { spawn, ChildProcess } from 'child_process'

// In CommonJS, __dirname is available by default
// No need for fileURLToPath or import.meta.url

let mainWindow: BrowserWindow | null = null
let serverProcess: ChildProcess | null = null

// Custom protocol for OAuth callbacks
const PROTOCOL = 'yggchat'

// Persistent storage for session data (initialized async)
let store: any = null

// Initialize electron-store (ESM module, needs dynamic import)
async function initializeStore() {
  const { default: Store } = await import('electron-store')
  store = new Store({
    name: 'ygg-chat-auth',
    encryptionKey: 'ygg-chat-electron-storage-key', // Optional encryption
  })
  console.log('[Electron] Storage initialized')
}

// Start embedded Express server
function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    // In production, server is bundled separately
    // In development, it's running separately via npm run dev:electron
    const isDev = process.env.NODE_ENV !== 'production'

    if (isDev) {
      console.log('[Electron] Development mode - assuming server is already running on port 3001')
      resolve()
      return
    }

    // Production: Start the bundled server
    const serverPath = path.join(process.resourcesPath, 'server', 'dist', 'index.js')

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: 'default',
    show: false, // Don't show until ready
  })

  // Show window when ready to avoid flicker
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  // Load the app
  const isDev = process.env.NODE_ENV !== 'production'

  if (isDev) {
    // Development: Load from Vite dev server
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // Production: Load from built files
    mainWindow.loadFile(path.join(__dirname, '../dist-electron/index.html'))
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
    console.log('[Electron] Server started, creating window...')
    createWindow()
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

// Storage - Persistent storage using electron-store
ipcMain.handle('storage:get', async (_event, key: string) => {
  console.log('[Electron IPC] storage:get called for key:', key)

  if (!store) {
    console.error('[Electron IPC] Storage not initialized yet')
    return null
  }

  try {
    const value = store.get(key)
    console.log('[Electron IPC] Retrieved value:', value ? 'found' : 'not found')
    return value || null
  } catch (error) {
    console.error('[Electron IPC] Failed to get from storage:', error)
    return null
  }
})

ipcMain.handle('storage:set', async (_event, key: string, value: any) => {
  console.log('[Electron IPC] storage:set called for key:', key)

  if (!store) {
    console.error('[Electron IPC] Storage not initialized yet')
    return { success: false, error: 'Storage not initialized' }
  }

  try {
    if (value === null || value === undefined) {
      // Delete key if value is null/undefined
      store.delete(key)
      console.log('[Electron IPC] Deleted key from storage')
    } else {
      store.set(key, value)
      console.log('[Electron IPC] Stored successfully')
    }
    return { success: true }
  } catch (error) {
    console.error('[Electron IPC] Failed to set storage:', error)
    return { success: false, error: String(error) }
  }
})

// Clear all storage (for logout/account switching)
ipcMain.handle('storage:clear', async () => {
  console.log('[Electron IPC] storage:clear called - clearing all stored data')

  if (!store) {
    console.error('[Electron IPC] Storage not initialized yet')
    return { success: false, error: 'Storage not initialized' }
  }

  try {
    store.clear()
    return { success: true }
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
