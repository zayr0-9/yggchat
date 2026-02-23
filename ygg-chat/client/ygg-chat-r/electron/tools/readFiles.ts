import * as path from 'path'
import { isWSLPath, resolveToWindowsPath, toWslPath } from '../utils/wslBridge.js'
import { ReadFileOptions, readTextFile } from './readFile.js'

export interface ReadMultipleOptions extends ReadFileOptions {
  baseDir?: string // used to compute the header-relative path separator
  // Inherits startLine, endLine, maxBytes from ReadFileOptions
}

export async function readMultipleTextFiles(
  inputPaths: string[],
  options: ReadMultipleOptions = {}
): Promise<
  Array<{
    filename: string
    content: string
    totalLines: number
  }>
> {
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

  const results: Array<{
    filename: string
    content: string
    totalLines: number
  }> = new Array(inputPaths.length)

  const readOne = async (p: string, index: number): Promise<void> => {
    try {
      const res = await readTextFile(p, {
        maxBytes: options.maxBytes,
        startLine: options.startLine,
        endLine: options.endLine,
        cwd: options.cwd,
        includeHash: false,
      })

      let absResolved = p
      if (isWSLPath(p)) {
        absResolved = await resolveToWindowsPath(p)
      } else {
        absResolved = path.resolve(cwdBase, p)
      }

      // Ensure we have a path compatible with baseDir (likely WSL/Posix) for relative calculation
      const absForRel = process.platform === 'win32' || isWSLPath(absResolved) ? toWslPath(absResolved) : absResolved

      // Use forward slashes for consistency in headers, even on Windows
      const rel = path.relative(baseDir, absForRel).replace(/\\/g, '/')

      let totalLines = res.totalLines
      if (totalLines === undefined) {
        // Calculate total lines if not returned (e.g. when reading full file without range)
        totalLines = res.content.split(/\r?\n/).length
      }

      results[index] = {
        filename: rel,
        content: res.content,
        totalLines,
      }
    } catch (error: any) {
      const errorMsg = `[Error reading file: ${error.message}]`

      results[index] = {
        filename: p,
        content: errorMsg,
        totalLines: 0,
      }
    }
  }

  const concurrency = Math.min(4, inputPaths.length)
  let nextIndex = 0

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const currentIndex = nextIndex++
      if (currentIndex >= inputPaths.length) {
        return
      }

      await readOne(inputPaths[currentIndex], currentIndex)
    }
  })

  await Promise.all(workers)

  return results
}
