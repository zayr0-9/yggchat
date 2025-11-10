// ygg-chat/server/src/utils/tools/core/glob.ts
import * as path from 'path'
import { glob as globCallback } from 'glob'
import { promisify } from 'util'

const globAsync = promisify(globCallback)

export interface GlobOptions {
  cwd?: string // Current working directory
  ignore?: string | string[] // Patterns to ignore
  dot?: boolean // Include dotfiles (default: false)
  absolute?: boolean // Return absolute paths (default: false)
  mark?: boolean // Add / suffix to directories (default: false)
  nosort?: boolean // Don't sort results (default: false)
  nocase?: boolean // Case-insensitive matching on Windows (default: false)
  nodir?: boolean // Don't match directories (default: false)
  follow?: boolean // Follow symbolic links (default: false)
  realpath?: boolean // Return resolved absolute paths (default: false)
  stat?: boolean // Call stat() on all results (default: false)
  withFileTypes?: boolean // Return Dirent objects instead of paths
}

export interface GlobResult {
  success: boolean
  matches: string[] // File paths that matched the pattern
  error?: string
  pattern?: string
  cwd?: string
  durationMs?: number
}

export async function globSearch(
  pattern: string,
  options: GlobOptions = {}
): Promise<GlobResult> {
  const startTime = Date.now()
  
  const {
    cwd = process.cwd(),
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
  } = options

  try {
    // Resolve cwd to absolute path for consistency
    const resolvedCwd = path.resolve(cwd)

    // Build glob options
    const globOptions: any = {
      cwd: resolvedCwd,
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
    }

    // Add ignore patterns if provided
    if (ignore) {
      globOptions.ignore = Array.isArray(ignore) ? ignore : [ignore]
    }

    // Execute glob search
    const results = await globAsync(pattern, globOptions)

    // Convert results to strings if withFileTypes is true
    let matches: string[]
    if (withFileTypes) {
      matches = (results as any[]).map((dirent: any) => dirent.fullpath() || dirent.path)
    } else {
      matches = results as string[]
    }

    return {
      success: true,
      matches,
      pattern,
      cwd: resolvedCwd,
      durationMs: Date.now() - startTime,
    }
  } catch (error: any) {
    return {
      success: false,
      matches: [],
      error: `Glob search failed: ${error.message}`,
      pattern,
      cwd: path.resolve(cwd),
      durationMs: Date.now() - startTime,
    }
  }
}

export default globSearch
