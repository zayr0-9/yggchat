import * as path from 'path'
import { readTextFile, ReadFileOptions } from './readFile.js'
import { resolveToWindowsPath, isWSLPath, toWslPath } from '../utils/wslBridge.js'

export interface ReadMultipleOptions extends ReadFileOptions {
  baseDir?: string // used to compute the header-relative path separator
  // Inherits startLine, endLine, maxBytes from ReadFileOptions
}

export async function readMultipleTextFiles(
  inputPaths: string[],
  options: ReadMultipleOptions = {}
): Promise<{
  combined: string
  files: Array<{
    relativePath: string
    sizeBytes: number
    truncated: boolean
    startLine?: number
    endLine?: number
    totalLines?: number
  }>
}> {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error('No file paths provided')
  }

  // Use cwd for path resolution, falling back to process.cwd()
  const cwdBase = options.cwd || process.cwd()

  const baseDir = options.baseDir
    ? path.isAbsolute(options.baseDir)
      ? options.baseDir
      : path.resolve(cwdBase, options.baseDir)
    : // Default to cwd or current working directory
    cwdBase

  const parts: string[] = []
  const meta: Array<{
    relativePath: string
    sizeBytes: number
    truncated: boolean
    startLine?: number
    endLine?: number
    totalLines?: number
  }> = []

  for (const p of inputPaths) {
    try {
      const res = await readTextFile(p, {
        maxBytes: options.maxBytes,
        startLine: options.startLine,
        endLine: options.endLine,
        cwd: options.cwd,
      })

      let absResolved = p
      if (isWSLPath(p)) {
        absResolved = await resolveToWindowsPath(p)
      } else {
        absResolved = path.resolve(cwdBase, p)
      }

      // Ensure we have a path compatible with baseDir (likely WSL/Posix) for relative calculation
      // If we are on Windows/WSL, we might want to ensure consistent format
      const absForRel = process.platform === 'win32' || isWSLPath(absResolved) ? toWslPath(absResolved) : absResolved

      // Use forward slashes for consistency in headers, even on Windows
      const rel = path.relative(baseDir, absForRel).replace(/\\/g, '/')

      // Separator is the relative path itself, on its own line
      if (parts.length > 0) parts.push('') // blank line between files
      parts.push(rel)
      parts.push(res.content)

      meta.push({
        relativePath: rel,
        sizeBytes: res.sizeBytes,
        truncated: res.truncated,
        startLine: res.startLine,
        endLine: res.endLine,
        totalLines: res.totalLines,
      })
    } catch (error: any) {
      // If one file fails, we might want to include the error in the output instead of crashing everything
      const errorMsg = `[Error reading file: ${error.message}]`

      if (parts.length > 0) parts.push('')
      parts.push(p) // Use the requested path as header
      parts.push(errorMsg)

      meta.push({
        relativePath: p,
        sizeBytes: 0,
        truncated: false,
      })
    }
  }

  return {
    combined: parts.join('\n'),
    files: meta,
  }
}
