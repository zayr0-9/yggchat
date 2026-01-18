// ygg-chat/server/src/utils/tools/core/glob.ts
import * as path from 'path'
import * as fs from 'fs'
import { glob } from 'glob'
import os from 'os'
import { resolveToWindowsPath, isWSLPath } from '../../wslBridge'

// Modern glob (v9+) returns Promise natively, no need for promisify
const globAsync = glob

const DEFAULT_MAX_MATCHES = 1000
const DEFAULT_TIMEOUT_MS = 5000
const DIRECTORY_DEPTH_LIMIT = 6
const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/.idea/**',
  '**/.vscode/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.cache/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/tmp/**',
  '**/temp/**',
  '**/*.min.js',
]

function resolveWorkspaceRoot(): string {
  const candidates = [
    process.env.WORKSPACE_ROOT,
    path.resolve(__dirname, '../../../../../'),
    process.cwd(),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate)
      if (!fs.existsSync(resolved)) continue
      const stats = fs.statSync(resolved)
      if (stats.isDirectory()) {
        return resolved
      }
    } catch {
      continue
    }
  }

  return process.cwd()
}

const WORKSPACE_ROOT = resolveWorkspaceRoot()
const NORMALIZED_ROOT = path.resolve(WORKSPACE_ROOT)
const HOMEDIR = os.homedir()

function isFsRoot(dir: string): boolean {
  const resolved = path.resolve(dir)
  const root = path.parse(resolved).root
  return resolved === root
}

async function ensureWithinWorkspace(cwd: string): Promise<string> {
  // If it's a WSL path, we treat it as safe/allowed for now because
  // we can't easily validate it against a Windows WORKSPACE_ROOT.
  // We resolve it to a Windows UNC path for consumption.
  if (isWSLPath(cwd)) {
     return await resolveToWindowsPath(cwd)
  }

  const resolved = path.resolve(cwd || WORKSPACE_ROOT)
  const normalized = resolved.replace(/\\/g, '/').replace(/\/+/g, '/')
  const normalizedRoot = NORMALIZED_ROOT.replace(/\\/g, '/').replace(/\/+/g, '/')

  if (!normalized.startsWith(normalizedRoot)) {
    // Just warning or error? The original code threw Error.
    // But if we are running server on windows for a WSL project, cwd passed might be completely outside server's source dir.
    // That's expected.
    // But we should still prevent traversing up to C:\ or /
    // For now let's keep the check for Windows paths.
    throw new Error(`cwd '${cwd}' is outside the workspace root (${WORKSPACE_ROOT}).`)
  }

  if (isFsRoot(resolved) || resolved === '/' || resolved === '/root' || resolved === HOMEDIR) {
    throw new Error('Glob search restricted: please use a project directory within the workspace, not filesystem root or home directory.')
  }

  return resolved
}

function mergeIgnorePatterns(defaults: string[], custom?: string | string[]): string[] {
  if (!custom) return defaults
  const userPatterns = Array.isArray(custom) ? custom : [custom]
  const cleaned = userPatterns.filter(Boolean)
  return Array.from(new Set([...defaults, ...cleaned]))
}

function enforcePatternDepth(pattern: string): string {
  const segments = pattern.split('/').filter(Boolean)
  if (segments.length <= DIRECTORY_DEPTH_LIMIT) return pattern
  return segments.slice(0, DIRECTORY_DEPTH_LIMIT).join('/')
}

export interface GlobOptions {
  cwd?: string
  ignore?: string | string[]
  dot?: boolean
  absolute?: boolean
  mark?: boolean
  nosort?: boolean
  nocase?: boolean
  nodir?: boolean
  follow?: boolean
  realpath?: boolean
  stat?: boolean
  withFileTypes?: boolean
  maxMatches?: number
  timeoutMs?: number
}

export interface GlobResult {
  success: boolean
  matches: string[]
  error?: string
  pattern?: string
  cwd?: string
  durationMs?: number
  totalMatches?: number
}

export async function globSearch(
  pattern: string,
  options: GlobOptions = {}
): Promise<GlobResult> {
  if (!pattern || pattern.trim() === '') {
    return {
      success: false,
      matches: [],
      error: 'Pattern cannot be empty',
    }
  }

  const startTime = Date.now()

  const {
    cwd = WORKSPACE_ROOT,
    ignore,
    dot = false,
    absolute = false,
    mark = false,
    nosort = false,
    nocase = false,
    nodir = false,
    follow = false,
    realpath = false,
    stat = false,
    withFileTypes = false,
    maxMatches = DEFAULT_MAX_MATCHES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  try {
    const resolvedCwd = await ensureWithinWorkspace(cwd)
    const sanitizedPattern = enforcePatternDepth(pattern)
    const ignorePatterns = mergeIgnorePatterns(DEFAULT_IGNORE_PATTERNS, ignore)

    const globOptions: any = {
      cwd: resolvedCwd,
      ignore: ignorePatterns,
      dot,
      absolute,
      mark,
      nosort,
      nocase,
      nodir,
      follow,
      realpath,
      stat,
      withFileTypes,
      windowsPathsNoEscape: true, // Help with UNC paths?
    }

    let results: any[]
    try {
      results = await Promise.race([
        globAsync(sanitizedPattern, globOptions),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Glob search timed out. Narrow the pattern or specify a smaller cwd.')), timeoutMs)
        ),
      ]) as any[]
    } catch (error: any) {
      throw new Error(error?.message || 'Glob search failed')
    }

    if (!Array.isArray(results)) {
      throw new Error('Glob search did not return an array of results')
    }

    if (results.length > maxMatches) {
      return {
        success: false,
        matches: [],
        error: `Too many matches (${results.length} > ${maxMatches}). Narrow the pattern or reduce cwd scope.`,
        pattern: sanitizedPattern,
        cwd: resolvedCwd,
        durationMs: Date.now() - startTime,
        totalMatches: results.length,
      }
    }

    const matches = withFileTypes
      ? (results as any[]).map((dirent: any) => dirent?.fullpath?.() || dirent?.path || String(dirent))
      : (results as string[])

    return {
      success: true,
      matches,
      pattern: sanitizedPattern,
      cwd: resolvedCwd,
      durationMs: Date.now() - startTime,
      totalMatches: matches.length,
    }
  } catch (error: any) {
    return {
      success: false,
      matches: [],
      error: error?.message || 'Glob search failed',
      pattern,
      cwd,
      durationMs: Date.now() - startTime,
    }
  }
}


export default globSearch

