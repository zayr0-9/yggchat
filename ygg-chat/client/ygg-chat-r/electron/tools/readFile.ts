import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { resolveToWindowsPath, isWSLPath, toWslPath } from '../utils/wslBridge.js'

export interface LineRange {
  startLine: number // 1-based line number to start reading from (inclusive)
  endLine: number // 1-based line number to stop reading at (inclusive)
}

export interface ReadFileOptions {
  maxBytes?: number // safety limit to avoid huge reads; default ~200KB
  startLine?: number // 1-based line number to start reading from (inclusive) - for single range
  endLine?: number // 1-based line number to stop reading at (inclusive) - for single range
  ranges?: LineRange[] // multiple disjoint ranges to read in a single call
  includeHash?: boolean // Calculate content hash for validation (default: true)
  cwd?: string // workspace directory for path resolution and restriction
  // Note: if 'ranges' is provided, startLine/endLine are ignored
}

export interface FileMetadata {
  lineEnding: '\n' | '\r\n' | 'mixed'
  hasBOM: boolean
  encoding: BufferEncoding
  lastModified: Date
  inode?: number // Unix inode number for change detection
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
  contentHash?: string // SHA256 hash of returned content for validation
  fileHash?: string // SHA256 hash of entire file (if content is partial)
  metadata: FileMetadata
  startLine?: number
  endLine?: number
  totalLines?: number
  ranges?: Array<{
    startLine: number
    endLine: number
    lineCount: number
  }>
}

/**
 * Calculate SHA256 hash of content
 */
function calculateHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Detect line ending style in content
 */
function detectLineEnding(content: string): '\n' | '\r\n' | 'mixed' {
  const hasCRLF = content.includes('\r\n')
  const hasLF = content.includes('\n')
  const lfOnlyCount = (content.match(/(?<!\r)\n/g) || []).length

  if (hasCRLF && lfOnlyCount > 0) return 'mixed'
  if (hasCRLF) return '\r\n'
  if (hasLF) return '\n'
  return '\n' // default for single-line files
}

/**
 * Detect BOM (Byte Order Mark) in buffer
 */
function hasBOM(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF
}

function resolveWslLikeAbsolutePath(inputPath: string, cwd?: string): string {
  const normalizedInput = toWslPath(inputPath)

  if (normalizedInput.startsWith('/')) {
    return path.posix.normalize(normalizedInput)
  }

  const normalizedBase = cwd ? toWslPath(cwd) : toWslPath(process.cwd())
  const basePath = normalizedBase.startsWith('/')
    ? normalizedBase
    : path.posix.resolve('/', normalizedBase)

  return path.posix.resolve(basePath, normalizedInput)
}

function assertWithinWorkspace(inputPath: string, resolvedPath: string, cwd: string, usePosix: boolean): void {
  if (usePosix) {
    const workspace = resolveWslLikeAbsolutePath(cwd)
    const target = resolveWslLikeAbsolutePath(resolvedPath)
    const rel = path.posix.relative(workspace, target)

    if (rel.startsWith('..') || path.posix.isAbsolute(rel)) {
      throw new Error(
        `Access denied: Path '${inputPath}' resolves to '${resolvedPath}' which is outside the workspace '${cwd}'. File operations are restricted to the workspace directory.`
      )
    }
    return
  }

  const workspace = path.resolve(cwd)
  const target = path.resolve(resolvedPath)
  const rel = path.relative(workspace, target)

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Access denied: Path '${inputPath}' resolves to '${resolvedPath}' which is outside the workspace '${cwd}'. File operations are restricted to the workspace directory.`
    )
  }
}

function validateLineRangeValues(options: ReadFileOptions): void {
  const validateLineNumber = (name: string, value: number) => {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be an integer >= 1`)
    }
  }

  if (options.startLine !== undefined) {
    validateLineNumber('startLine', options.startLine)
  }
  if (options.endLine !== undefined) {
    validateLineNumber('endLine', options.endLine)
  }

  if (options.ranges) {
    for (let i = 0; i < options.ranges.length; i++) {
      const range = options.ranges[i]
      validateLineNumber(`ranges[${i}].startLine`, range.startLine)
      validateLineNumber(`ranges[${i}].endLine`, range.endLine)
    }
  }
}

export async function readTextFile(
  inputPath: string,
  options: ReadFileOptions = {}
): Promise<ReadFileResult> {
  const maxBytes = options.maxBytes && options.maxBytes > 0 ? options.maxBytes : 200 * 1024
  const includeHash = options.includeHash !== false // default to true

  validateLineRangeValues(options)

  // Resolve absolute path and track path type
  let abs = inputPath
  let pathType: 'windows' | 'wsl' | 'posix' = 'posix'
  const willBeWsl = isWSLPath(inputPath)

  if (willBeWsl) {
    pathType = 'wsl'
    abs = resolveWslLikeAbsolutePath(inputPath, options.cwd)
  } else {
    const basePath = options.cwd || process.cwd()
    abs = path.isAbsolute(inputPath) ? inputPath : path.resolve(basePath, inputPath)
    if (/^[a-zA-Z]:[\\\/]/.test(abs)) {
      pathType = 'windows'
    }
  }

  if (options.cwd) {
    assertWithinWorkspace(inputPath, abs, options.cwd, pathType === 'wsl')
  }

  // Convert to UNC for filesystem access
  if (pathType === 'wsl') {
    abs = await resolveToWindowsPath(abs)
  }

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

  // Determine if we need line-based access
  const needsLineAccess =
    options.startLine !== undefined ||
    options.endLine !== undefined ||
    (options.ranges && options.ranges.length > 0)

  // Only apply maxBytes truncation if NOT doing line-based slicing
  const toRead = needsLineAccess ? sizeBytes : Math.min(sizeBytes, maxBytes)

  // Read only up to maxBytes (or full file if line ranges specified)
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

  // Collect metadata before processing
  const bomDetected = hasBOM(buf)
  let content = buf.toString('utf8')
  const fullFileContent = content // Store original for hash calculation
  const truncated = !needsLineAccess && sizeBytes > maxBytes

  // Detect line ending style from original full content
  const lineEndingStyle = detectLineEnding(content)
  const lineEnding = lineEndingStyle === 'mixed' || lineEndingStyle === '\r\n' ? '\r\n' : '\n'

  // Handle line-range slicing if requested
  let actualStartLine: number | undefined
  let actualEndLine: number | undefined
  let totalLines: number | undefined
  let rangesInfo: Array<{ startLine: number; endLine: number; lineCount: number }> | undefined

  // Split preserving all line ending types
  const splitLines = (text: string): string[] => {
    // Split by any line ending but preserve the actual ending used
    return text.split(/\r?\n/)
  }

  // Multi-range support takes precedence
  if (options.ranges && options.ranges.length > 0) {
    const lines = splitLines(content)
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

      // CRITICAL: Do NOT add header comments - they don't exist in the actual file
      // and will cause mismatches with editFile. Range info is in metadata.
      selectedParts.push(rangeLines.join(lineEnding))
      if (options.ranges && options.ranges.length > 1) {
        // Only add separator between multiple ranges
        selectedParts.push('') // blank line between ranges
      }

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

    content = selectedParts.join(lineEnding)
  } else if (options.startLine !== undefined || options.endLine !== undefined) {
    // Single range support (backward compatible)
    const lines = splitLines(content)
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
    content = selectedLines.join(lineEnding)

    actualStartLine = start
    actualEndLine = end
  }

  // Calculate content hashes if requested
  const contentHash = includeHash ? calculateHash(content) : undefined
  const fileHash = includeHash && content !== fullFileContent ? calculateHash(fullFileContent) : contentHash

  // Build metadata
  const metadata: FileMetadata = {
    lineEnding: lineEndingStyle,
    hasBOM: bomDetected,
    encoding: 'utf8',
    lastModified: stats.mtime,
    inode: stats.ino,
  }

  return {
    content,
    truncated,
    sizeBytes,
    contentHash,
    fileHash,
    metadata,
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
  options: Omit<ReadFileOptions, 'startLine' | 'endLine' | 'ranges'> & { cwd?: string } = {}
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
