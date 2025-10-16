// ygg-chat/server/src/utils/tools/core/readFiles.ts
import * as path from 'path'
import { readTextFile, ReadFileOptions } from './readFile'

export interface ReadMultipleOptions extends ReadFileOptions {
  baseDir?: string // used to compute the header-relative path separator
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
  }> = []

  for (const p of inputPaths) {
    const res = await readTextFile(p, { maxBytes: options.maxBytes })
    const rel = path.relative(baseDir, res.absolutePath).replaceAll('\\', '/')

    // Separator is the relative path itself, on its own line
    if (parts.length > 0) parts.push('') // blank line between files
    parts.push(rel)
    parts.push(res.content)

    meta.push({
      relativePath: rel,
      absolutePath: res.absolutePath,
      sizeBytes: res.sizeBytes,
      truncated: res.truncated,
    })
  }

  return {
    combined: parts.join('\n'),
    files: meta,
  }
}
