// Local file operations for Electron mode
import { Express } from 'express'
import fs from 'fs'
import path from 'path'
import { detectPathType, isWindows, resolveToWindowsPath, toWslPath } from './utils/wslBridge.js'

/**
 * Register local file operation routes
 * These routes provide file system access for the Electron app
 */
export function registerLocalOperationsRoutes(app: Express) {
  // GET /api/local/files - List files in a directory
  // Query params: path (required) - directory path to list
  app.get('/api/local/files', async (req, res): Promise<void> => {
    const dirPath = req.query.path as string

    if (!dirPath) {
      res.status(400).json({ error: 'path query parameter is required' })
      return
    }

    try {
      const requestedPath = dirPath.trim()
      const requestedPathType = detectPathType(requestedPath)

      // Resolve to filesystem path (Windows can receive Linux/WSL style paths)
      let fsPath = requestedPath
      if (isWindows() && requestedPathType === 'linux') {
        fsPath = await resolveToWindowsPath(requestedPath)
      }
      const resolvedPath = path.resolve(fsPath)

      // Check if path exists and is a directory
      const stats = await fs.promises.stat(resolvedPath)
      if (!stats.isDirectory()) {
        res.status(400).json({ error: 'Path is not a directory' })
        return
      }

      // Keep response path style stable for UI navigation when user provided WSL/Linux path
      const useWslStyleResponse = isWindows() && requestedPathType === 'linux'
      const responseBasePath = useWslStyleResponse
        ? toWslPath(requestedPath).replace(/\/+$/, '') || '/'
        : resolvedPath

      // Read directory entries with file types
      const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true })

      // Map to file info objects, filtering out hidden files and common ignored directories
      const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '__pycache__', '.venv', 'dist', 'build', '.next'])

      const files = entries
        .filter(entry => !entry.name.startsWith('.') && !IGNORED_DIRS.has(entry.name))
        .map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: useWslStyleResponse
            ? path.posix.join(responseBasePath === '/' ? '/' : responseBasePath, entry.name)
            : path.join(resolvedPath, entry.name),
        }))
        .sort((a, b) => {
          // Directories first, then alphabetical
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })

      res.json({ path: responseBasePath, files })
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'Directory not found' })
        return
      }
      if (error.code === 'EACCES') {
        res.status(403).json({ error: 'Permission denied' })
        return
      }
      console.error('Error listing directory:', error)
      res.status(500).json({ error: 'Failed to list directory' })
    }
  })
}
