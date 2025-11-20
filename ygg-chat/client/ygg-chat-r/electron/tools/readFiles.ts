import * as path from 'path'
import { readTextFile, ReadFileOptions } from './readFile'

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
    absolutePath: string
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

  const baseDir = options.baseDir
    ? path.isAbsolute(options.baseDir)
      ? options.baseDir
      : path.resolve(process.cwd(), options.baseDir)
    : // Default to the current working directory
      process.cwd()

  const parts: string[] = []
  const meta: Array<{
    relativePath: string
    absolutePath: string
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
      })
      
      // Use forward slashes for consistency in headers, even on Windows
      const rel = path.relative(baseDir, res.absolutePath).replace(/\\/g, '/')

      // Separator is the relative path itself, on its own line
      if (parts.length > 0) parts.push('') // blank line between files
      parts.push(rel)
      parts.push(res.content)

      meta.push({
        relativePath: rel,
        absolutePath: res.absolutePath,
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
            absolutePath: '',
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
