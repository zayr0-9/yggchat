import { spawn } from 'child_process';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import Conf from 'conf';
import os from 'os';
import fs from 'fs';
// ESM: Get __dirname from import.meta.url
const __dirname = fileURLToPath(new URL('.', import.meta.url));
let mainWindow = null;
let serverProcess = null;
// Custom protocol for OAuth callbacks
const PROTOCOL = 'yggchat';
// Persistent storage for session data (initialized async)
let store = null;
let storeInitialized = false;
// In-memory fallback storage
const memoryStore = new Map();
// Initialize conf (ESM module)
async function initializeStore() {
    try {
        const configDir = path.join(os.homedir(), '.config', 'ygg-chat-r');
        const configFile = path.join(configDir, 'config.json');
        // Check if config file exists and is corrupted
        if (fs.existsSync(configFile)) {
            try {
                const content = fs.readFileSync(configFile, 'utf-8');
                // Try to parse to validate JSON
                JSON.parse(content);
            }
            catch (parseError) {
                console.warn('[Electron] Config file corrupted, removing:', configFile);
                try {
                    fs.unlinkSync(configFile);
                }
                catch (unlinkError) {
                    console.warn('[Electron] Failed to remove corrupted config file:', unlinkError);
                }
            }
        }
        // Initialize conf (ESM library)
        store = new Conf({
            projectName: 'ygg-chat-r',
            configFileMode: 0o600,
        });
        storeInitialized = true;
        console.log('[Electron] Storage initialized successfully (conf)');
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        console.error('[Electron] Failed to initialize conf storage');
        console.error('[Electron] Error message:', errorMsg);
        console.error('[Electron] Error stack:', errorStack);
        console.warn('[Electron] ⚠️  Using in-memory fallback storage');
        console.warn('[Electron] Note: Data will not persist after app restart');
        storeInitialized = true; // Mark as initialized even with fallback
    }
}
// Helper functions for storage access with fallback
function getFromStore(key) {
    if (!storeInitialized) {
        console.warn('[Electron] Store not yet initialized');
        return null;
    }
    try {
        if (store) {
            return store.get(key);
        }
        else {
            // Use in-memory fallback
            return memoryStore.get(key) || null;
        }
    }
    catch (error) {
        console.error('[Electron] Error reading from store:', error);
        return memoryStore.get(key) || null;
    }
}
function setInStore(key, value) {
    if (!storeInitialized) {
        console.warn('[Electron] Store not yet initialized');
        return false;
    }
    try {
        if (store) {
            store.set(key, value);
            return true;
        }
        else {
            // Use in-memory fallback
            memoryStore.set(key, value);
            return true;
        }
    }
    catch (error) {
        console.error('[Electron] Error writing to store:', error);
        // Fallback to memory
        memoryStore.set(key, value);
        return false;
    }
}
function deleteFromStore(key) {
    if (!storeInitialized) {
        console.warn('[Electron] Store not yet initialized');
        return false;
    }
    try {
        if (store) {
            store.delete(key);
            return true;
        }
        else {
            memoryStore.delete(key);
            return true;
        }
    }
    catch (error) {
        console.error('[Electron] Error deleting from store:', error);
        memoryStore.delete(key);
        return false;
    }
}
function clearStore() {
    if (!storeInitialized) {
        console.warn('[Electron] Store not yet initialized');
        return false;
    }
    try {
        if (store) {
            store.clear();
            return true;
        }
        else {
            memoryStore.clear();
            return true;
        }
    }
    catch (error) {
        console.error('[Electron] Error clearing store:', error);
        memoryStore.clear();
        return false;
    }
}
// Start embedded Express server
function startServer() {
    return new Promise((resolve, reject) => {
        // In production, server is bundled separately
        // In development, it's running separately via npm run dev:electron
        const isDev = process.env.NODE_ENV !== 'production';
        if (isDev) {
            console.log('[Electron] Development mode - assuming server is already running on port 3001');
            resolve();
            return;
        }
        // Production: Start the bundled server
        const serverPath = path.join(process.resourcesPath, 'server', 'dist', 'index.js');
        console.log('[Electron] Starting embedded server from:', serverPath);
        serverProcess = spawn(process.execPath, [serverPath], {
            env: {
                ...process.env,
                VITE_ENVIRONMENT: 'electron',
                PORT: '3001',
                NODE_ENV: 'production',
            },
            stdio: 'inherit',
        });
        serverProcess.on('error', (err) => {
            console.error('[Electron] Server failed to start:', err);
            reject(err);
        });
        serverProcess.on('exit', (code, signal) => {
            console.log(`[Electron] Server process exited with code ${code} and signal ${signal}`);
        });
        // Wait a bit for server to start
        setTimeout(() => {
            console.log('[Electron] Server should be ready');
            resolve();
        }, 2000);
    });
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
    });
    // Show window when ready to avoid flicker
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
    });
    // Load the app
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev) {
        // Development: Load from Vite dev server
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    }
    else {
        // Production: Load from built files
        mainWindow.loadFile(path.join(__dirname, '../dist-electron/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
// Register protocol handler for OAuth callbacks
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
}
else {
    app.setAsDefaultProtocolClient(PROTOCOL);
}
// Handle protocol on macOS
app.on('open-url', (event, url) => {
    event.preventDefault();
    handleOAuthCallback(url);
});
// Handle protocol on Windows/Linux (via second instance)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
}
else {
    app.on('second-instance', (_event, commandLine) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
        // The commandLine is an array of strings in which the last element is the deep link url
        // On Windows/Linux, the protocol URL will be in the command line arguments
        const url = commandLine.find(arg => arg.startsWith(`${PROTOCOL}://`));
        if (url) {
            handleOAuthCallback(url);
        }
    });
}
// Handle OAuth callback from external browser
function handleOAuthCallback(url) {
    console.log('[Electron] Received OAuth callback:', url);
    // Send the callback URL to the renderer process
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('oauth:callback', url);
        // Focus the window
        if (mainWindow.isMinimized())
            mainWindow.restore();
        mainWindow.focus();
    }
}
// App lifecycle
app.whenReady().then(async () => {
    try {
        console.log('[Electron] App ready, initializing storage...');
        await initializeStore();
        console.log('[Electron] Storage initialized, starting server...');
        await startServer();
        console.log('[Electron] Server started, creating window...');
        createWindow();
    }
    catch (error) {
        console.error('[Electron] Failed to start:', error);
        app.quit();
    }
});
app.on('window-all-closed', () => {
    // Kill server when app closes
    if (serverProcess) {
        console.log('[Electron] Killing server process...');
        serverProcess.kill();
        serverProcess = null;
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
app.on('before-quit', () => {
    // Ensure server is killed
    if (serverProcess) {
        serverProcess.kill();
        serverProcess = null;
    }
});
// IPC Handlers for Electron-specific features
// Authentication (optional - for cloud sync)
ipcMain.handle('auth:login', async (_event, _credentials) => {
    // In Electron, we can store credentials securely using electron-store or keytar
    // For now, return a simple success
    console.log('[Electron IPC] auth:login called');
    return { success: true, userId: 'electron-user-id' };
});
ipcMain.handle('auth:logout', async () => {
    console.log('[Electron IPC] auth:logout called');
    // Clear stored credentials
    return { success: true };
});
// Storage - Persistent storage using electron-store with fallback
ipcMain.handle('storage:get', async (_event, key) => {
    console.log('[Electron IPC] storage:get called for key:', key);
    if (!storeInitialized) {
        console.error('[Electron IPC] Storage not initialized yet');
        return null;
    }
    try {
        const value = getFromStore(key);
        console.log('[Electron IPC] Retrieved value:', value ? 'found' : 'not found');
        return value || null;
    }
    catch (error) {
        console.error('[Electron IPC] Failed to get from storage:', error);
        return null;
    }
});
ipcMain.handle('storage:set', async (_event, key, value) => {
    console.log('[Electron IPC] storage:set called for key:', key);
    if (!storeInitialized) {
        console.error('[Electron IPC] Storage not initialized yet');
        return { success: false, error: 'Storage not initialized' };
    }
    try {
        if (value === null || value === undefined) {
            // Delete key if value is null/undefined
            const success = deleteFromStore(key);
            console.log('[Electron IPC] Deleted key from storage');
            return { success };
        }
        else {
            const success = setInStore(key, value);
            console.log('[Electron IPC] Stored successfully');
            return { success };
        }
    }
    catch (error) {
        console.error('[Electron IPC] Failed to set storage:', error);
        return { success: false, error: String(error) };
    }
});
// Clear all storage (for logout/account switching)
ipcMain.handle('storage:clear', async () => {
    console.log('[Electron IPC] storage:clear called - clearing all stored data');
    if (!storeInitialized) {
        console.error('[Electron IPC] Storage not initialized yet');
        return { success: false, error: 'Storage not initialized' };
    }
    try {
        const success = clearStore();
        return { success };
    }
    catch (error) {
        console.error('[Electron IPC] Failed to clear storage:', error);
        return { success: false, error: String(error) };
    }
});
// Get platform info
ipcMain.handle('platform:info', async () => {
    return {
        platform: process.platform,
        version: app.getVersion(),
        isElectron: true,
    };
});
// Open OAuth URL in external browser
ipcMain.handle('auth:openExternal', async (_event, url) => {
    console.log('[Electron IPC] Opening external URL for OAuth:', url);
    try {
        await shell.openExternal(url);
        return { success: true };
    }
    catch (error) {
        console.error('[Electron IPC] Failed to open external URL:', error);
        return { success: false, error: String(error) };
    }
});
//# sourceMappingURL=main.js.map