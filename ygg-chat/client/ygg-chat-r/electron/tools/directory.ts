import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'
import { detectPathType, isWindows, resolveToWindowsPath } from '../utils/wslBridge.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const readdir = promisify(fs.readdir)
const stat = promisify(fs.stat)
const readFile = promisify(fs.readFile)
function normalizeForComparison(inputPath: string): string {
  const resolved = path.resolve(inputPath)
  const normalized = resolved.replace(/\\/g, '/')

  if (normalized === '/') {
    return '/'
  }

  return normalized.replace(/\/+$/, '')
}

function isFsRootPath(inputPath: string): boolean {

  if (!inputPath) {
    return false
  }

  const parsedRoot = path.parse(inputPath).root
  if (!parsedRoot) {
    return false
  }

  return normalizeForComparison(inputPath) === normalizeForComparison(parsedRoot)
}

function detectWorkspaceRoot(): string {
  const candidates = [
    process.env.WORKSPACE_ROOT?.trim(),
    path.resolve(__dirname, '../..'),
    path.resolve(process.cwd()),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const resolved = path.resolve(candidate)
      const stats = fs.statSync(resolved)
      if (stats.isDirectory()) {
        return resolved
      }
    } catch {
      continue
    }
  }

  return path.resolve(process.cwd())
}

const WORKSPACE_ROOT = detectWorkspaceRoot()
const NORMALIZED_WORKSPACE_ROOT = normalizeForComparison(WORKSPACE_ROOT)

function isSameOrSubPath(candidate: string, root: string): boolean {
  if (candidate === root) return true
  if (!candidate.startsWith(root)) return false
  const nextChar = candidate[root.length]
  return nextChar === '/' || nextChar === undefined
}

function ensurePathWithinWorkspace(candidatePath: string): string {
  const resolved = path.resolve(candidatePath)
  const normalized = normalizeForComparison(resolved)

  if (isSameOrSubPath(normalized, NORMALIZED_WORKSPACE_ROOT)) {
    return resolved
  }

  throw new Error(
    `Access to '${candidatePath}' is blocked. Directory paths must stay within '${WORKSPACE_ROOT}'.`
  )
}

async function resolveRequestedDirectory(rawRootDir: string): Promise<string> {
  const trimmed = (rawRootDir ?? '').trim()
  const sanitized = trimmed.length === 0 ? '.' : trimmed

  if (sanitized === '.' || sanitized === './') {
    return WORKSPACE_ROOT
  }

  if (isFsRootPath(sanitized)) {
    throw new Error('Access to the filesystem root is not allowed.')
  }

  let candidateInput = sanitized
  const pathType = detectPathType(candidateInput)

  // On Windows with a Linux path, convert to UNC path
  if (isWindows() && pathType === 'linux') {
    candidateInput = await resolveToWindowsPath(candidateInput)
  }

  const resolved = path.isAbsolute(candidateInput)
    ? candidateInput
    : path.resolve(WORKSPACE_ROOT, candidateInput)

  return ensurePathWithinWorkspace(resolved)
}

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

function limitDepth(maxDepth?: number): number | undefined {
  if (maxDepth === undefined) {
    return undefined
  }

  if (Number.isNaN(maxDepth) || maxDepth < 1) {
    return 1
  }

  return Math.min(5, Math.floor(maxDepth))
}

export async function extractDirectoryStructure(rawRootDir: string, options: DirectoryOptions = {}): Promise<string> {
  const { maxDepth, includeHidden = false, includeSizes = false } = options

  const resolvedRootDir = await resolveRequestedDirectory(rawRootDir)
  const maxDepthLimit = limitDepth(maxDepth)

  try {
    const rootStat = await stat(resolvedRootDir)
    if (!rootStat.isDirectory()) {
      throw new Error(`'${rawRootDir}' is not a directory`)
    }
  } catch (error) {
    throw new Error(`Directory '${rawRootDir}' does not exist or is not accessible`)
  }

  const gitignorePatterns = await loadGitignorePatterns(resolvedRootDir)
  const result: string[] = []

  async function walkDirectory(currentPath: string, indent = '', depth = 0): Promise<void> {
    if (maxDepthLimit !== undefined && depth >= maxDepthLimit) {
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
    const filteredEntries: Array<{ name: string; isDir: boolean; path: string; stats?: fs.Stats }> = []

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry)
      // Calculate relative path for gitignore checking. 
      // Note: resolvedRootDir might be a UNC path on Windows, entryPath as well.
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

      filteredEntries.push({ name: entry, isDir, path: entryPath, stats: includeSizes ? entryStats : undefined })
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
      const suffix = entry.isDir ? '/' : ''
      let sizePart = ''

      if (!entry.isDir && includeSizes && entry.stats) {
        sizePart = ` (${getFileSizeStr(entry.stats.size)})`
      }

      // We want to display just the name in the tree structure, not full path
      const line = `${indent}${entry.name}${suffix}${sizePart}`
      result.push(line)

      // Recurse into directories
      if (entry.isDir) {
        const nextIndent = indent + '  '
        await walkDirectory(entry.path, nextIndent, depth + 1)
      }
    }
  }

  await walkDirectory(resolvedRootDir)
  return result.join('\n')
}

export default extractDirectoryStructure
