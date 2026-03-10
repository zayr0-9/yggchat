// Local file operations for Electron mode
import { Express } from 'express'
import fs from 'fs'
import path from 'path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { detectPathType, isWindows, resolveToWindowsPath, toWslPath } from './utils/wslBridge.js'

const execFile = promisify(execFileCb)

const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '__pycache__', '.venv', 'dist', 'build', '.next'])
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_DIRECTORIES = 10000
const GIT_COMMAND_TIMEOUT_MS = 2500
const GIT_COMMAND_MAX_BUFFER = 16 * 1024 * 1024

type ResolvedDirectory = {
  resolvedPath: string
  responseBasePath: string
  useWslStyleResponse: boolean
}

type LocalSearchEntry = {
  name: string
  isDirectory: boolean
  path: string
  relativePath: string
}

const sortEntries = (entries: fs.Dirent[]): fs.Dirent[] =>
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

const isVisibleEntry = (entry: fs.Dirent): boolean => !entry.name.startsWith('.') && !IGNORED_DIRS.has(entry.name)

const joinResponsePath = (basePath: string, childName: string, useWslStyleResponse: boolean): string => {
  if (useWslStyleResponse) {
    return path.posix.join(basePath === '/' ? '/' : basePath, childName)
  }
  return path.join(basePath, childName)
}

const normalizeRelativePosix = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\//, '')

const parseBooleanQueryParam = (value: unknown, defaultValue: boolean): boolean => {
  if (typeof value !== 'string') return defaultValue
  const normalized = value.trim().toLowerCase()
  if (!normalized) return defaultValue
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

const resolveDirectory = async (requestedPathRaw: string): Promise<ResolvedDirectory> => {
  const requestedPath = requestedPathRaw.trim()
  const requestedPathType = detectPathType(requestedPath)

  let fsPath = requestedPath
  if (isWindows() && requestedPathType === 'linux') {
    fsPath = await resolveToWindowsPath(requestedPath)
  }

  const resolvedPath = path.resolve(fsPath)
  const stats = await fs.promises.stat(resolvedPath)
  if (!stats.isDirectory()) {
    const error = new Error('Path is not a directory') as NodeJS.ErrnoException
    error.code = 'ENOTDIR'
    throw error
  }

  const useWslStyleResponse = isWindows() && requestedPathType === 'linux'
  const responseBasePath = useWslStyleResponse ? toWslPath(requestedPath).replace(/\/+$/, '') || '/' : resolvedPath

  return { resolvedPath, responseBasePath, useWslStyleResponse }
}

const searchWithGitignore = async (params: {
  resolvedPath: string
  responseBasePath: string
  useWslStyleResponse: boolean
  query: string
  limit: number
}): Promise<{ files: LocalSearchEntry[]; truncated: boolean } | null> => {
  const { resolvedPath, responseBasePath, useWslStyleResponse, query, limit } = params

  let repoRoot = ''
  try {
    const rootResult = await execFile('git', ['-C', resolvedPath, 'rev-parse', '--show-toplevel'], {
      timeout: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER,
      windowsHide: true,
    })
    repoRoot = String(rootResult.stdout || '').trim()
  } catch {
    return null
  }

  if (!repoRoot) return null

  const relativeBaseRaw = path.relative(repoRoot, resolvedPath)
  if (relativeBaseRaw.startsWith('..')) return null

  const relativeBase = normalizeRelativePosix(relativeBaseRaw)

  let lsFilesOutput = ''
  try {
    const lsFilesResult = await execFile('git', ['-C', repoRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '--full-name'], {
      timeout: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER,
      windowsHide: true,
    })
    lsFilesOutput = String(lsFilesResult.stdout || '')
  } catch {
    return null
  }

  const needle = query.toLowerCase()
  const files: LocalSearchEntry[] = []

  const lines = lsFilesOutput
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  for (const repoRelativeFile of lines) {
    const normalizedRepoRelative = normalizeRelativePosix(repoRelativeFile)

    if (relativeBase) {
      const basePrefix = `${relativeBase}/`
      if (normalizedRepoRelative !== relativeBase && !normalizedRepoRelative.startsWith(basePrefix)) {
        continue
      }
    }

    const relativeFromSearchRoot = relativeBase
      ? normalizedRepoRelative.slice(relativeBase.length + (normalizedRepoRelative === relativeBase ? 0 : 1))
      : normalizedRepoRelative

    if (!relativeFromSearchRoot) continue

    const fileName = path.posix.basename(relativeFromSearchRoot)
    const haystack = `${fileName} ${relativeFromSearchRoot}`.toLowerCase()
    if (!haystack.includes(needle)) continue

    const responsePath = useWslStyleResponse
      ? path.posix.join(responseBasePath === '/' ? '/' : responseBasePath, relativeFromSearchRoot)
      : path.join(resolvedPath, ...relativeFromSearchRoot.split('/'))

    files.push({
      name: fileName,
      isDirectory: false,
      path: responsePath,
      relativePath: relativeFromSearchRoot,
    })

    if (files.length >= limit) {
      break
    }
  }

  return {
    files,
    truncated: files.length >= limit,
  }
}

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
      const { resolvedPath, responseBasePath, useWslStyleResponse } = await resolveDirectory(dirPath)
      const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true })

      const files = sortEntries(entries)
        .filter(isVisibleEntry)
        .map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: joinResponsePath(responseBasePath, entry.name, useWslStyleResponse),
        }))

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
      if (error.code === 'ENOTDIR') {
        res.status(400).json({ error: 'Path is not a directory' })
        return
      }
      console.error('Error listing directory:', error)
      res.status(500).json({ error: 'Failed to list directory' })
    }
  })

  // GET /api/local/files/search - Recursively search files/folders within a directory
  // Query params:
  // - path (required): root directory path to search
  // - query (required): case-insensitive search substring
  // - limit (optional): max results (default 200, max 500)
  // - followGitignore (optional): when true (default), attempt gitignore-aware search in git repos
  app.get('/api/local/files/search', async (req, res): Promise<void> => {
    const dirPath = req.query.path as string
    const query = String(req.query.query ?? req.query.q ?? '').trim()

    if (!dirPath) {
      res.status(400).json({ error: 'path query parameter is required' })
      return
    }

    if (!query) {
      res.status(400).json({ error: 'query parameter is required' })
      return
    }

    const requestedLimit = Number(req.query.limit)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 500)
      : MAX_SEARCH_RESULTS

    const followGitignore = parseBooleanQueryParam(req.query.followGitignore, true)

    try {
      const { resolvedPath, responseBasePath, useWslStyleResponse } = await resolveDirectory(dirPath)
      const normalizedNeedle = query.toLowerCase()

      if (followGitignore) {
        const gitignoreAware = await searchWithGitignore({
          resolvedPath,
          responseBasePath,
          useWslStyleResponse,
          query,
          limit,
        })

        if (gitignoreAware) {
          res.json({
            path: responseBasePath,
            query,
            files: gitignoreAware.files,
            truncated: gitignoreAware.truncated,
            respectingGitignore: true,
          })
          return
        }
      }

      const queue: Array<{ fsPath: string; responsePath: string; relativePath: string }> = [
        { fsPath: resolvedPath, responsePath: responseBasePath, relativePath: '' },
      ]

      const files: LocalSearchEntry[] = []
      let visitedDirectories = 0

      while (queue.length > 0 && files.length < limit) {
        const node = queue.shift()
        if (!node) break

        visitedDirectories += 1
        if (visitedDirectories > MAX_SEARCH_DIRECTORIES) break

        let entries: fs.Dirent[] = []
        try {
          entries = await fs.promises.readdir(node.fsPath, { withFileTypes: true })
        } catch {
          continue
        }

        const visibleEntries = sortEntries(entries).filter(isVisibleEntry)

        for (const entry of visibleEntries) {
          const entryPath = joinResponsePath(node.responsePath, entry.name, useWslStyleResponse)
          const entryRelativePath = node.relativePath ? path.posix.join(node.relativePath, entry.name) : entry.name
          const searchText = `${entry.name} ${entryRelativePath}`.toLowerCase()

          if (searchText.includes(normalizedNeedle)) {
            files.push({
              name: entry.name,
              isDirectory: entry.isDirectory(),
              path: entryPath,
              relativePath: entryRelativePath,
            })
            if (files.length >= limit) break
          }

          if (entry.isDirectory()) {
            const entryFsPath = path.join(node.fsPath, entry.name)
            queue.push({
              fsPath: entryFsPath,
              responsePath: entryPath,
              relativePath: entryRelativePath,
            })
          }
        }
      }

      res.json({
        path: responseBasePath,
        query,
        files,
        truncated: files.length >= limit,
        respectingGitignore: false,
      })
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'Directory not found' })
        return
      }
      if (error.code === 'EACCES') {
        res.status(403).json({ error: 'Permission denied' })
        return
      }
      if (error.code === 'ENOTDIR') {
        res.status(400).json({ error: 'Path is not a directory' })
        return
      }
      console.error('Error searching directory:', error)
      res.status(500).json({ error: 'Failed to search directory' })
    }
  })
}
