// ygg-chat/server/src/utils/tools/core/readFile.ts
import * as fs from 'fs'
import * as path from 'path'

export interface LineRange {
  startLine: number // 1-based line number to start reading from (inclusive)
  endLine: number // 1-based line number to stop reading at (inclusive)
}

export interface ReadFileOptions {
  maxBytes?: number // safety limit to avoid huge reads; default ~200KB
  startLine?: number // 1-based line number to start reading from (inclusive) - for single range
  endLine?: number // 1-based line number to stop reading at (inclusive) - for single range
  ranges?: LineRange[] // multiple disjoint ranges to read in a single call
  // Note: if 'ranges' is provided, startLine/endLine are ignored
}

function isLikelyBinary(buf: Buffer): boolean {
  // Heuristic: if buffer contains many null bytes or non-text control chars
  // within the first chunk, treat as binary
  const len = Math.min(buf.length, 4096)
  let suspicious = 0
  for (let i = 0; i < len; i++) {
    const byte = buf[i]
    if (byte === 0) return true
    // allow common control chars: tab(9), lf(10), cr(13)
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious++
  }
  return suspicious / len > 0.3
}

export interface ReadFileResult {
  content: string
  truncated: boolean
  sizeBytes: number
  absolutePath: string
  startLine?: number
  endLine?: number
  totalLines?: number
  ranges?: Array<{
    startLine: number
    endLine: number
    lineCount: number
  }>
}

export async function readTextFile(
  inputPath: string,
  options: ReadFileOptions = {}
): Promise<ReadFileResult> {
  const maxBytes = options.maxBytes && options.maxBytes > 0 ? options.maxBytes : 200 * 1024

  // Resolve absolute path
  const abs = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath)

  // Check existence and get size
  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(abs)
  } catch (e) {
    throw new Error(`File '${inputPath}' does not exist or is not accessible`)
  }
  if (!stats.isFile()) {
    throw new Error(`'${inputPath}' is not a file`)
  }

  const sizeBytes = stats.size
  const toRead = Math.min(sizeBytes, maxBytes)

  // Read only up to maxBytes
  let buf: Buffer
  if (toRead === sizeBytes) {
    buf = await fs.promises.readFile(abs)
  } else {
    const fd = await fs.promises.open(abs, 'r')
    try {
      buf = Buffer.allocUnsafe(toRead)
      await fd.read(buf, 0, toRead, 0)
    } finally {
      await fd.close()
    }
  }

  // Detect binary
  if (isLikelyBinary(buf)) {
    throw new Error('Binary file detected; reading binary is not supported by this tool')
  }

  let content = buf.toString('utf8')
  const truncated = sizeBytes > maxBytes

  // Handle line-range slicing if requested
  let actualStartLine: number | undefined
  let actualEndLine: number | undefined
  let totalLines: number | undefined
  let rangesInfo: Array<{ startLine: number; endLine: number; lineCount: number }> | undefined

  // Multi-range support takes precedence
  if (options.ranges && options.ranges.length > 0) {
    const lines = content.split('\n')
    totalLines = lines.length

    // Validate and process each range
    const selectedParts: string[] = []
    rangesInfo = []

    for (const range of options.ranges) {
      const start = Math.max(1, range.startLine)
      const end = Math.min(totalLines, range.endLine)

      if (start > totalLines) {
        throw new Error(`Range startLine ${start} exceeds total lines ${totalLines} in file`)
      }
      if (end < start) {
        throw new Error(`Range endLine ${end} cannot be less than startLine ${start}`)
      }

      // Extract lines for this range (convert to 0-based indexing)
      const rangeLines = lines.slice(start - 1, end)

      // Add a header comment to mark the range
      selectedParts.push(`// Lines ${start}-${end}`)
      selectedParts.push(rangeLines.join('\n'))
      selectedParts.push('') // blank line between ranges

      rangesInfo.push({
        startLine: start,
        endLine: end,
        lineCount: rangeLines.length,
      })
    }

    // Remove trailing blank line
    if (selectedParts[selectedParts.length - 1] === '') {
      selectedParts.pop()
    }

    content = selectedParts.join('\n')
  } else if (options.startLine !== undefined || options.endLine !== undefined) {
    // Single range support (backward compatible)
    const lines = content.split('\n')
    totalLines = lines.length

    // Validate and normalize line numbers (1-based to 0-based)
    const start = options.startLine !== undefined ? Math.max(1, options.startLine) : 1
    const end = options.endLine !== undefined ? Math.min(totalLines, options.endLine) : totalLines

    if (start > totalLines) {
      throw new Error(`startLine ${start} exceeds total lines ${totalLines} in file`)
    }
    if (end < start) {
      throw new Error(`endLine ${end} cannot be less than startLine ${start}`)
    }

    // Slice the lines (convert to 0-based indexing)
    const selectedLines = lines.slice(start - 1, end)
    content = selectedLines.join('\n')

    actualStartLine = start
    actualEndLine = end
  }

  return {
    content,
    truncated,
    sizeBytes,
    absolutePath: abs,
    startLine: actualStartLine,
    endLine: actualEndLine,
    totalLines,
    ranges: rangesInfo,
  }
}

/**
 * Read the next chunk of a file after a given line number.
 * Useful for pagination and avoiding duplicate reads.
 *
 * @param inputPath - File path to read
 * @param afterLine - 1-based line number to start reading after (exclusive)
 * @param numLines - Number of lines to read
 * @param options - Additional read options (maxBytes, etc.)
 * @returns ReadFileResult with the continuation content
 */
export async function readFileContinuation(
  inputPath: string,
  afterLine: number,
  numLines: number,
  options: Omit<ReadFileOptions, 'startLine' | 'endLine' | 'ranges'> = {}
): Promise<ReadFileResult> {
  if (afterLine < 0) {
    throw new Error('afterLine must be >= 0 (use 0 to read from beginning)')
  }
  if (numLines < 1) {
    throw new Error('numLines must be >= 1')
  }

  const startLine = afterLine + 1
  const endLine = afterLine + numLines

  return readTextFile(inputPath, {
    ...options,
    startLine,
    endLine,
  })
}
