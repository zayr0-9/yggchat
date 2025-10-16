// ygg-chat/server/src/utils/tools/core/directoryTree.ts
import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'

const readdir = promisify(fs.readdir)
const stat = promisify(fs.stat)
const readFile = promisify(fs.readFile)

export interface DirectoryOptions {
  maxDepth?: number
  includeHidden?: boolean
  includeSizes?: boolean
}

// Common ignore patterns
const DEFAULT_IGNORE_PATTERNS: Set<string> = new Set([
  // Version control
  '.git',
  '.svn',
  '.hg',
  '.bzr',
  // Dependencies
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'vendor',
  '.bundle',
  'bower_components',
  // Build outputs
  'dist',
  'build',
  'target',
  'bin',
  'obj',
  'out',
  '.next',
  '.nuxt',
  '.output',
  // IDE/Editor
  '.vscode',
  '.idea',
  // OS
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  // Logs and temp
  '.cache',
  '.temp',
])

const WILDCARD_IGNORE_PATTERNS = ['*.swp', '*.swo', '*~', '*.log', '*.tmp']

async function loadGitignorePatterns(directory: string): Promise<Set<string>> {
  const gitignorePath = path.join(directory, '.gitignore')
  const patterns = new Set<string>()

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = await readFile(gitignorePath, 'utf-8')
      content.split('\n').forEach(line => {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!')) {
          patterns.add(trimmed)
        }
      })
    }
  } catch {
    // Silently ignore errors reading .gitignore
  }

  return patterns
}

function matchesPattern(name: string, pattern: string): boolean {
  // Simple glob matching for *.ext patterns
  if (pattern.includes('*')) {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special regex chars except *
      .replace(/\*/g, '.*') // replace * with .*
    return new RegExp(`^${regex}$`).test(name)
  }
  return name === pattern
}

function shouldIgnore(relPath: string, entryName: string, isDir: boolean, ignorePatterns: Set<string>): boolean {
  // Check against default patterns
  if (DEFAULT_IGNORE_PATTERNS.has(entryName)) {
    return true
  }

  // Check against wildcard patterns
  for (const pattern of WILDCARD_IGNORE_PATTERNS) {
    if (matchesPattern(entryName, pattern)) {
      return true
    }
  }

  // Check against gitignore patterns
  for (const pattern of ignorePatterns) {
    if (matchesPattern(entryName, pattern)) {
      return true
    }
    if (matchesPattern(relPath, pattern)) {
      return true
    }
    // Handle directory patterns ending with '/'
    if (pattern.endsWith('/') && isDir) {
      const dirPattern = pattern.slice(0, -1)
      if (matchesPattern(entryName, dirPattern)) {
        return true
      }
    }
  }

  return false
}

function getFileSizeStr(sizeBytes: number): string {
  if (sizeBytes === 0) return '0B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = sizeBytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)}${units[unitIndex]}`
}

export async function extractDirectoryStructure(rootDir: string, options: DirectoryOptions = {}): Promise<string> {
  const { maxDepth, includeHidden = false, includeSizes = false } = options

  const resolvedRootDir = path.resolve(rootDir)

  // Check if directory exists
  try {
    const rootStat = await stat(resolvedRootDir)
    if (!rootStat.isDirectory()) {
      throw new Error(`'${rootDir}' is not a directory`)
    }
  } catch (error) {
    throw new Error(`Directory '${rootDir}' does not exist or is not accessible`)
  }

  // Load ignore patterns
  const gitignorePatterns = await loadGitignorePatterns(resolvedRootDir)
  const result: string[] = []

  async function walkDirectory(currentPath: string, indent = '', depth = 0): Promise<void> {
    if (maxDepth !== undefined && depth > 50) {
      return
    }

    let entries: string[]
    try {
      entries = await readdir(currentPath)
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        const nodeError = error as NodeJS.ErrnoException
        if (nodeError.code === 'EACCES') {
          result.push(`${indent}[Permission Denied]`)
          return
        }
      }
      result.push(`${indent}[Error: ${error instanceof Error ? error.message : 'Unknown error'}]`)
      return
    }

    // Filter entries
    const filteredEntries: Array<{ name: string; isDir: boolean; stats?: fs.Stats }> = []

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry)
      const relPath = path.relative(resolvedRootDir, entryPath)

      // Skip hidden files unless requested
      if (!includeHidden && entry.startsWith('.')) {
        continue
      }

      let entryStats: fs.Stats
      let isDir: boolean

      try {
        entryStats = await stat(entryPath)
        isDir = entryStats.isDirectory()
      } catch {
        continue // Skip inaccessible entries
      }

      // Skip ignored patterns
      if (shouldIgnore(relPath, entry, isDir, gitignorePatterns)) {
        continue
      }

      filteredEntries.push({
        name: entry,
        isDir,
        stats: includeSizes ? entryStats : undefined,
      })
    }

    // Sort: directories first, then alphabetically (case-insensitive)
    filteredEntries.sort((a, b) => {
      if (a.isDir !== b.isDir) {
        return a.isDir ? -1 : 1
      }
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })

    // Process entries
    for (const entry of filteredEntries) {
      const prefixChar = entry.isDir ? '/' : '-'
      const suffix = entry.isDir ? '/' : ''
      let sizePart = ''

      if (!entry.isDir && includeSizes && entry.stats) {
        sizePart = ` (${getFileSizeStr(entry.stats.size)})`
      }

      const line = `${indent}${prefixChar}${entry.name}${suffix}${sizePart}`
      result.push(line)

      // Recurse into directories
      if (entry.isDir) {
        const nextIndent = indent + ' '
        const childPath = path.join(currentPath, entry.name)
        await walkDirectory(childPath, nextIndent, depth + 1)
      }
    }
  }

  await walkDirectory(resolvedRootDir)
  return result.join('\n')
}
