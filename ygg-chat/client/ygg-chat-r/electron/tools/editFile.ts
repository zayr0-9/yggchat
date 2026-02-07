import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { readTextFile, FileMetadata } from './readFile.js'
import { isWSLPath, resolveToWindowsPath, toWslPath } from '../utils/wslBridge.js'

const FULL_FILE_READ_MAX_BYTES = Number.MAX_SAFE_INTEGER

export interface EditFileOptions {
  createBackup?: boolean
  encoding?: BufferEncoding
  enableFuzzyMatching?: boolean // Enable layered matching strategies (default: true)
  fuzzyThreshold?: number // Similarity threshold for fuzzy matching (default: 0.8)
  preserveIndentation?: boolean // Preserve original indentation style (default: true)
  interpretEscapeSequences?: boolean // Interpret \n, \t, etc. in patterns (default: true)
  operationMode?: 'plan' | 'execute'
  validateContent?: boolean // Validate file hasn't changed since read (default: true)
  expectedHash?: string // Expected content hash from previous read
  expectedMetadata?: FileMetadata // Expected file metadata from previous read
  cwd?: string // Workspace directory for path resolution and restriction
}

export type EditOperation = 'replace' | 'replace_first' | 'append'

export type MatchStrategy = 'exact' | 'line_ending_normalized' | 'whitespace_normalized' | 'fuzzy'

export interface MatchResult {
  found: boolean
  startIndex: number
  endIndex: number
  matchedText: string
  strategy: MatchStrategy
  similarity?: number // For fuzzy matches
}

export interface FileValidationResult {
  valid: boolean
  reason?: string
  expectedHash?: string
  actualHash?: string
  expectedModified?: Date
  actualModified?: Date
}

export interface EditFileResult {
  success: boolean
  sizeBytes: number
  replacements: number
  message: string
  backup?: string
  matchStrategy?: MatchStrategy // Which strategy succeeded
  attemptedStrategies?: string[] // For debugging failed matches
  validation?: FileValidationResult // Validation result if performed
}

async function readFullTextFileForEdit(filePath: string, cwd?: string) {
  const fileData = await readTextFile(filePath, {
    cwd,
    maxBytes: FULL_FILE_READ_MAX_BYTES,
  })

  if (fileData.truncated) {
    throw new Error(
      `Refusing to edit '${filePath}' because the file read was truncated.`
    )
  }

  return fileData
}

/**
 * Edit a file using simple search and replace operations.
 * Much faster and more context-efficient than AST-based editing.
 *
 * @param filePath - The path to the file to edit
 * @param searchPattern - The text pattern to find
 * @param replacement - The replacement text
 * @param options - Optional settings for the edit operation
 * @returns Promise<EditFileResult>
 */
export async function editFileSearchReplace(
  filePath: string,
  searchPattern: string,
  replacement: string,
  options: EditFileOptions = {}
): Promise<EditFileResult> {
  const {
    createBackup = false,
    encoding = 'utf8',
    enableFuzzyMatching = true,
    fuzzyThreshold = 0.8,
    preserveIndentation = true,
    interpretEscapeSequences: shouldInterpretEscapes = true,
    validateContent = true,
  } = options

  try {
    // Resolve path for fs operations and track path type
    let fsPath: string = filePath  // Path for fs.promises operations
    let pathType: 'windows' | 'wsl' | 'posix' = 'posix'
    const willBeWsl = isWSLPath(filePath)

    // For WSL paths, resolve to absolute Linux path first (for validation)
    if (willBeWsl) {
      pathType = 'wsl'
      // Make path absolute using POSIX rules (before UNC conversion)
      if (!filePath.startsWith('/')) {
        fsPath = options.cwd ? `${options.cwd.replace(/\/$/, '')}/${filePath}` : filePath
      }
    } else {
      const basePath = options.cwd || process.cwd()
      fsPath = path.isAbsolute(filePath) ? filePath : path.resolve(basePath, filePath)
      if (/^[a-zA-Z]:[\/]/.test(fsPath)) {
        pathType = 'windows'
      }
    }

    // Workspace validation BEFORE UNC conversion (compare Linux to Linux)
    if (options.cwd) {
      if (pathType === 'wsl') {
        // Both are Linux paths - compare directly using POSIX rules
        const normalizedCwd = options.cwd.replace(/\/$/, '')
        const normalizedPath = fsPath.replace(/\/$/, '')
        if (!normalizedPath.startsWith(normalizedCwd + '/') && normalizedPath !== normalizedCwd) {
          return {
            success: false,
            sizeBytes: 0,
            replacements: 0,
            message: `Access denied: Path '${filePath}' is outside the workspace '${options.cwd}'. File operations are restricted to the workspace directory.`
          }
        }
      } else {
        // Windows or native paths - use Node's path module
        const normalizedCwd = path.resolve(options.cwd)
        const normalizedPath = path.resolve(fsPath)
        if (!normalizedPath.startsWith(normalizedCwd + path.sep) && normalizedPath !== normalizedCwd) {
          return {
            success: false,
            sizeBytes: 0,
            replacements: 0,
            message: `Access denied: Path '${filePath}' is outside the workspace '${options.cwd}'. File operations are restricted to the workspace directory.`
          }
        }
      }
    }

    // NOW convert to UNC for filesystem access
    if (pathType === 'wsl') {
      fsPath = await resolveToWindowsPath(fsPath)
    }

    // Read the file first
    const fileData = await readFullTextFileForEdit(filePath, options.cwd)
    const originalContent = fileData.content

    // Validate file content if requested
    let validation: FileValidationResult | undefined
    if (validateContent) {
      validation = await validateFileContent(fsPath, originalContent, options)
      if (!validation.valid) {
        return {
          success: false,
          sizeBytes: fileData.sizeBytes,
          replacements: 0,
          message: `Validation failed: ${validation.reason}`,
          validation,
        }
      }
    }

    // Perform search and replace
    let newContent: string
    let replacements: number
    let matchStrategy: MatchStrategy | undefined
    let attemptedStrategies: string[] = []
    const processedSearchPattern = interpretEscapeSequences(searchPattern, shouldInterpretEscapes)

    // Try layered matching strategies
    const matchResult = findMatchWithStrategies(
      originalContent,
      processedSearchPattern,
      enableFuzzyMatching,
      fuzzyThreshold,
      false
    )
    attemptedStrategies = matchResult.attemptedStrategies

    if (!matchResult.found) {
      return {
        success: false,
        sizeBytes: fileData.sizeBytes,
        replacements: 0,
        message: `Search pattern not found in file. Attempted strategies: ${attemptedStrategies.join(', ')}`,
        attemptedStrategies,
      }
    }

    matchStrategy = matchResult.strategy

    // Apply indentation preservation if enabled and using non-exact match
    let finalReplacement = replacement
    if (preserveIndentation && matchResult.strategy !== 'exact') {
      const originalIndentation = captureIndentation(matchResult.matchedText)
      finalReplacement = applyIndentation(replacement, originalIndentation)
    }

    // Interpret escape sequences in replacement
    finalReplacement = interpretEscapeSequences(finalReplacement, shouldInterpretEscapes)

    // Keep replacement scope aligned with the strategy that actually matched.
    if (matchResult.strategy === 'exact') {
      const exactRegex = new RegExp(escapeRegExp(processedSearchPattern), 'g')
      const exactMatches = originalContent.match(exactRegex)
      if (!exactMatches || exactMatches.length === 0 || processedSearchPattern === finalReplacement) {
        newContent = originalContent
        replacements = 0
      } else {
        replacements = exactMatches.length
        // Use a replacer function so replacement text is treated literally (no $&/$1 interpolation).
        newContent = originalContent.replace(exactRegex, () => finalReplacement)
      }
    } else {
      if (matchResult.matchedText === finalReplacement) {
        newContent = originalContent
        replacements = 0
      } else {
        replacements = 1
        newContent =
          originalContent.substring(0, matchResult.startIndex) +
          finalReplacement +
          originalContent.substring(matchResult.endIndex)
      }
    }

    // Create backup if requested
    let backupPath: string | undefined
    if (createBackup && replacements > 0) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      backupPath = `${fsPath}.backup.${timestamp}`
      await fs.promises.writeFile(backupPath, originalContent, encoding)
    }

    // Write the modified content back to file
    if (replacements > 0) {
      await fs.promises.writeFile(fsPath, newContent, encoding)
    }

    // Get new file size
    const newStats = await fs.promises.stat(fsPath)

    const strategyMessage =
      matchStrategy && matchStrategy !== 'exact'
        ? ` (matched using ${matchStrategy} strategy)`
        : ''

    return {
      success: true,
      sizeBytes: newStats.size,
      replacements,
      message:
        replacements > 0
          ? `Successfully replaced ${replacements} occurrence(s)${strategyMessage} in ${filePath}`
          : `No changes needed in ${filePath}`,
      backup: backupPath ? (pathType === 'windows' ? backupPath : toWslPath(backupPath)) : undefined,
      matchStrategy,
      attemptedStrategies,
      validation,
    }
  } catch (error: any) {
    return {
      success: false,
      sizeBytes: 0,
      replacements: 0,
      message: `Error editing file: ${error.message}`,
    }
  }
}

/**
 * Edit a file by replacing the first occurrence of a pattern
 */
export async function editFileSearchReplaceFirst(
  filePath: string,
  searchPattern: string,
  replacement: string,
  options: EditFileOptions = {}
): Promise<EditFileResult> {
  const {
    createBackup = false,
    encoding = 'utf8',
    enableFuzzyMatching = true,
    fuzzyThreshold = 0.8,
    preserveIndentation = true,
    interpretEscapeSequences: shouldInterpretEscapes = true,
    validateContent = true,
  } = options

  try {
    // Resolve path for fs operations and track path type
    let fsPath: string = filePath  // Path for fs.promises operations
    let pathType: 'windows' | 'wsl' | 'posix' = 'posix'
    const willBeWsl = isWSLPath(filePath)

    // For WSL paths, resolve to absolute Linux path first (for validation)
    if (willBeWsl) {
      pathType = 'wsl'
      // Make path absolute using POSIX rules (before UNC conversion)
      if (!filePath.startsWith('/')) {
        fsPath = options.cwd ? `${options.cwd.replace(/\/$/, '')}/${filePath}` : filePath
      }
    } else {
      const basePath = options.cwd || process.cwd()
      fsPath = path.isAbsolute(filePath) ? filePath : path.resolve(basePath, filePath)
      if (/^[a-zA-Z]:[\/]/.test(fsPath)) {
        pathType = 'windows'
      }
    }

    // Workspace validation BEFORE UNC conversion (compare Linux to Linux)
    if (options.cwd) {
      if (pathType === 'wsl') {
        // Both are Linux paths - compare directly using POSIX rules
        const normalizedCwd = options.cwd.replace(/\/$/, '')
        const normalizedPath = fsPath.replace(/\/$/, '')
        if (!normalizedPath.startsWith(normalizedCwd + '/') && normalizedPath !== normalizedCwd) {
          return {
            success: false,
            sizeBytes: 0,
            replacements: 0,
            message: `Access denied: Path '${filePath}' is outside the workspace '${options.cwd}'. File operations are restricted to the workspace directory.`
          }
        }
      } else {
        // Windows or native paths - use Node's path module
        const normalizedCwd = path.resolve(options.cwd)
        const normalizedPath = path.resolve(fsPath)
        if (!normalizedPath.startsWith(normalizedCwd + path.sep) && normalizedPath !== normalizedCwd) {
          return {
            success: false,
            sizeBytes: 0,
            replacements: 0,
            message: `Access denied: Path '${filePath}' is outside the workspace '${options.cwd}'. File operations are restricted to the workspace directory.`
          }
        }
      }
    }

    // NOW convert to UNC for filesystem access
    if (pathType === 'wsl') {
      fsPath = await resolveToWindowsPath(fsPath)
    }

    const fileData = await readFullTextFileForEdit(filePath, options.cwd)
    const originalContent = fileData.content

    // Validate file content if requested
    let validation: FileValidationResult | undefined
    if (validateContent) {
      validation = await validateFileContent(fsPath, originalContent, options)
      if (!validation.valid) {
        return {
          success: false,
          sizeBytes: fileData.sizeBytes,
          replacements: 0,
          message: `Validation failed: ${validation.reason}`,
          validation,
        }
      }
    }

    // Try layered matching strategies
    const processedSearchPattern = interpretEscapeSequences(searchPattern, shouldInterpretEscapes)
    const matchResult = findMatchWithStrategies(
      originalContent,
      processedSearchPattern,
      enableFuzzyMatching,
      fuzzyThreshold,
      false
    )

    if (!matchResult.found) {
      return {
        success: false,
        sizeBytes: fileData.sizeBytes,
        replacements: 0,
        message: `Search pattern not found in file. Attempted strategies: ${matchResult.attemptedStrategies.join(', ')}`,
        attemptedStrategies: matchResult.attemptedStrategies,
      }
    }

    // Apply indentation preservation if enabled and using non-exact match
    let finalReplacement = replacement
    if (preserveIndentation && matchResult.strategy !== 'exact') {
      const originalIndentation = captureIndentation(matchResult.matchedText)
      finalReplacement = applyIndentation(replacement, originalIndentation)
    }

    // Interpret escape sequences in replacement
    finalReplacement = interpretEscapeSequences(finalReplacement, shouldInterpretEscapes)

    const hasChanges = finalReplacement !== matchResult.matchedText
    const newContent = hasChanges
      ? originalContent.substring(0, matchResult.startIndex) +
        finalReplacement +
        originalContent.substring(matchResult.endIndex)
      : originalContent

    // Create backup if requested
    let backupPath: string | undefined
    if (createBackup && hasChanges) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      backupPath = `${fsPath}.backup.${timestamp}`
      await fs.promises.writeFile(backupPath, originalContent, encoding)
    }

    // Write the modified content if needed
    if (hasChanges) {
      await fs.promises.writeFile(fsPath, newContent, encoding)
    }

    const newStats = await fs.promises.stat(fsPath)

    const strategyMessage =
      matchResult.strategy !== 'exact' ? ` (matched using ${matchResult.strategy} strategy)` : ''

    return {
      success: true,
      sizeBytes: newStats.size,
      replacements: hasChanges ? 1 : 0,
      message: hasChanges
        ? `Successfully replaced first occurrence${strategyMessage} in ${filePath}`
        : `No changes needed in ${filePath}`,
      backup: backupPath ? (pathType === 'windows' ? backupPath : toWslPath(backupPath)) : undefined,
      matchStrategy: matchResult.strategy,
      attemptedStrategies: matchResult.attemptedStrategies,
      validation,
    }
  } catch (error: any) {
    return {
      success: false,
      sizeBytes: 0,
      replacements: 0,
      message: `Error editing file: ${error.message}`,
    }
  }
}

/**
 * Edit a file by appending content to the end
 */
export async function appendToFile(
  filePath: string,
  content: string,
  options: EditFileOptions = {}
): Promise<EditFileResult> {
  const { createBackup = false, encoding = 'utf8' } = options

  try {
    // Resolve path for fs operations and track path type
    let fsPath: string = filePath  // Path for fs.promises operations
    let pathType: 'windows' | 'wsl' | 'posix' = 'posix'
    const willBeWsl = isWSLPath(filePath)

    // For WSL paths, resolve to absolute Linux path first (for validation)
    if (willBeWsl) {
      pathType = 'wsl'
      // Make path absolute using POSIX rules (before UNC conversion)
      if (!filePath.startsWith('/')) {
        fsPath = options.cwd ? `${options.cwd.replace(/\/$/, '')}/${filePath}` : filePath
      }
    } else {
      const basePath = options.cwd || process.cwd()
      fsPath = path.isAbsolute(filePath) ? filePath : path.resolve(basePath, filePath)
      if (/^[a-zA-Z]:[\/]/.test(fsPath)) {
        pathType = 'windows'
      }
    }

    // Workspace validation BEFORE UNC conversion (compare Linux to Linux)
    if (options.cwd) {
      if (pathType === 'wsl') {
        // Both are Linux paths - compare directly using POSIX rules
        const normalizedCwd = options.cwd.replace(/\/$/, '')
        const normalizedPath = fsPath.replace(/\/$/, '')
        if (!normalizedPath.startsWith(normalizedCwd + '/') && normalizedPath !== normalizedCwd) {
          return {
            success: false,
            sizeBytes: 0,
            replacements: 0,
            message: `Access denied: Path '${filePath}' is outside the workspace '${options.cwd}'. File operations are restricted to the workspace directory.`
          }
        }
      } else {
        // Windows or native paths - use Node's path module
        const normalizedCwd = path.resolve(options.cwd)
        const normalizedPath = path.resolve(fsPath)
        if (!normalizedPath.startsWith(normalizedCwd + path.sep) && normalizedPath !== normalizedCwd) {
          return {
            success: false,
            sizeBytes: 0,
            replacements: 0,
            message: `Access denied: Path '${filePath}' is outside the workspace '${options.cwd}'. File operations are restricted to the workspace directory.`
          }
        }
      }
    }

    // NOW convert to UNC for filesystem access
    if (pathType === 'wsl') {
      fsPath = await resolveToWindowsPath(fsPath)
    }

    let originalContent = ''
    let fileExists = true

    try {
      const fileData = await readFullTextFileForEdit(filePath, options.cwd)
      originalContent = fileData.content
      // Note: fileData.absolutePath is already in WSL format, don't use it for fs operations
    } catch {
      fileExists = false
    }

    // Create backup if file exists and backup requested
    let backupPath: string | undefined
    if (createBackup && fileExists) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      backupPath = `${fsPath}.backup.${timestamp}`
      await fs.promises.writeFile(backupPath, originalContent, encoding)
    }

    // Append content using fsPath (UNC format on Windows)
    await fs.promises.appendFile(fsPath, content, encoding)

    const newStats = await fs.promises.stat(fsPath)

    return {
      success: true,
      sizeBytes: newStats.size,
      replacements: 1, // Consider append as one "replacement"
      message: `Successfully appended content to ${filePath}`,
      backup: backupPath ? (pathType === 'windows' ? backupPath : toWslPath(backupPath)) : undefined,

    }

  } catch (error: any) {
    return {
      success: false,
      sizeBytes: 0,
      replacements: 0,
      message: `Error appending to file: ${error.message}`,
    }
  }
}

/**
 * Unified edit file function that supports multiple operations
 */
export async function editFile(
  filePath: string,
  operation: EditOperation,
  options: EditFileOptions & {
    searchPattern?: string
    replacement?: string
    content?: string
  } = {}
): Promise<EditFileResult> {
  // Block file editing in plan mode
  if (options.operationMode === 'plan') {
    return {
      success: false,
      sizeBytes: 0,
      replacements: 0,
      message: 'You are in planning mode. File modification is not allowed. Please describe your implementation plan instead.',
    }
  }

  const { searchPattern, replacement, content } = options

  switch (operation) {
    case 'replace':
      if (!searchPattern || replacement === undefined) {
        return {
          success: false,
          sizeBytes: 0,
          replacements: 0,
          message: 'searchPattern and replacement are required for replace operation',
        }
      }
      return editFileSearchReplace(filePath, searchPattern, replacement, options)

    case 'replace_first':
      if (!searchPattern || replacement === undefined) {
        return {
          success: false,
          sizeBytes: 0,
          replacements: 0,
          message: 'searchPattern and replacement are required for replace_first operation',
        }
      }
      return editFileSearchReplaceFirst(filePath, searchPattern, replacement, options)

    case 'append':
      if (content === undefined) {
        return {
          success: false,
          sizeBytes: 0,
          replacements: 0,
          message: 'content is required for append operation',
        }
      }
      return appendToFile(filePath, content, options)

    default:
      return {
        success: false,
        sizeBytes: 0,
        replacements: 0,
        message: `Unknown operation: ${operation}`,
      }
  }
}

/**
 * Calculate SHA256 hash of content
 */
function calculateHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Validate file content hasn't changed since it was read
 */
async function validateFileContent(
  absolutePath: string,
  content: string,
  options: EditFileOptions
): Promise<FileValidationResult> {
  if (!options.validateContent) {
    return { valid: true }
  }

  const stats = await fs.promises.stat(absolutePath)
  const currentHash = options.expectedHash ? calculateHash(content) : undefined

  // Check hash if provided
  if (options.expectedHash && currentHash !== options.expectedHash) {
    return {
      valid: false,
      reason: 'Content hash mismatch - file may have been modified',
      expectedHash: options.expectedHash,
      actualHash: currentHash,
    }
  }

  // Check modification time if metadata provided
  if (options.expectedMetadata?.lastModified) {
    const expectedTime = new Date(options.expectedMetadata.lastModified).getTime()
    const actualTime = stats.mtime.getTime()

    if (actualTime > expectedTime) {
      return {
        valid: false,
        reason: 'File has been modified since it was read',
        expectedModified: options.expectedMetadata.lastModified,
        actualModified: stats.mtime,
      }
    }
  }

  return { valid: true }
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Interpret common escape sequences in a string.
 * Converts literal escape sequences to their actual characters:
 * - \\n → newline
 * - \\r → carriage return
 * - \\t → tab
 * - \\\\ → preserved as literal backslashes
 * - \\' → single quote
 * - \\" → double quote
 *
 * @param str - String potentially containing escape sequences
 * @param enable - Whether to perform interpretation (default: true)
 * @returns String with escape sequences interpreted
 */
function interpretEscapeSequences(str: string, enable: boolean = true): string {
  if (!enable) return str

  // Use placeholder to protect literal backslashes (\\)
  const BACKSLASH_PLACEHOLDER = '\u0000LITERAL_BACKSLASH\u0000'

  return str
    // First, protect literal backslashes: \\ → placeholder
    .replace(/\\\\/g, BACKSLASH_PLACEHOLDER)
    // Then interpret escape sequences
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    // Finally, restore literal backslashes without collapsing them
    .replace(new RegExp(BACKSLASH_PLACEHOLDER, 'g'), '\\\\')
}

/**
 * Normalize line endings to \n
 */
function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Normalize whitespace by collapsing multiple spaces/tabs to single space
 * and trimming each line
 */
function normalizeWhitespace(str: string): string {
  return str
    .split('\n')
    .map(normalizeWhitespaceLine)
    .join('\n')
}

function normalizeWhitespaceLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Calculate similarity ratio between two strings (0 to 1)
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const distance = levenshteinDistance(a, b)
  const maxLength = Math.max(a.length, b.length)
  return 1 - distance / maxLength
}

/**
 * Find a fuzzy match in content by sliding window
 */
function findFuzzyMatch(
  content: string,
  pattern: string,
  threshold: number = 0.8
): { found: boolean; startIndex: number; endIndex: number; similarity: number; matchedText: string } {
  const normalizedPattern = normalizeWhitespace(pattern)
  const patternLines = normalizedPattern.split('\n').length
  const contentLines = content.split('\n')

  let bestMatch = {
    found: false,
    startIndex: -1,
    endIndex: -1,
    similarity: 0,
    matchedText: '',
  }

  // Slide through content line by line
  for (let i = 0; i <= contentLines.length - patternLines; i++) {
    const candidateLines = contentLines.slice(i, i + patternLines)
    const candidateText = candidateLines.join('\n')
    const normalizedCandidate = normalizeWhitespace(candidateText)

    const similarity = calculateSimilarity(normalizedPattern, normalizedCandidate)

    if (similarity > bestMatch.similarity && similarity >= threshold) {
      // Calculate actual string indices
      const linesBeforeMatch = contentLines.slice(0, i).join('\n')
      const startIndex = linesBeforeMatch.length + (i > 0 ? 1 : 0) // +1 for newline
      const endIndex = startIndex + candidateText.length

      bestMatch = {
        found: true,
        startIndex,
        endIndex,
        similarity,
        matchedText: candidateText,
      }
    }
  }

  return bestMatch
}

/**
 * Capture indentation information from text
 */
function captureIndentation(text: string): string[] {
  return text.split('\n').map(line => {
    const match = line.match(/^(\s*)/)
    return match ? match[1] : ''
  })
}

/**
 * Apply original indentation to replacement text
 */
function applyIndentation(replacement: string, originalIndentation: string[]): string {
  const replacementLines = replacement.split('\n')

  if (replacementLines.length === 0) return replacement
  if (originalIndentation.length === 0) return replacement

  // Get the base indentation from the first line of original
  const baseIndent = originalIndentation[0] || ''

  // Calculate relative indentation in replacement
  const replacementIndents = captureIndentation(replacement)
  const replacementBaseIndent = replacementIndents[0] || ''

  return replacementLines
    .map((line, index) => {
      const lineIndent = replacementIndents[index] || ''
      const trimmedLine = line.trimStart()

      if (trimmedLine === '') return '' // Keep empty lines empty

      // Calculate how much this line is indented relative to the first replacement line
      const relativeIndent =
        lineIndent.length <= replacementBaseIndent.length
          ? ''
          : lineIndent.slice(replacementBaseIndent.length)

      // Apply original base indent while preserving tabs/spaces from relative indentation
      const newIndent = baseIndent + relativeIndent
      return newIndent + trimmedLine
    })
    .join('\n')
}

/**
 * Find match using layered strategies
 */
function findMatchWithStrategies(
  content: string,
  pattern: string,
  enableFuzzy: boolean = true,
  fuzzyThreshold: number = 0.8,
  interpretEscapes: boolean = true
): MatchResult & { attemptedStrategies: string[] } {
  const attemptedStrategies: string[] = []

  // Interpret escape sequences in pattern at the start
  const processedPattern = interpretEscapeSequences(pattern, interpretEscapes)

  // Strategy 1: Exact match
  attemptedStrategies.push('exact')
  const exactIndex = content.indexOf(processedPattern)
  if (exactIndex !== -1) {
    return {
      found: true,
      startIndex: exactIndex,
      endIndex: exactIndex + processedPattern.length,
      matchedText: processedPattern,
      strategy: 'exact',
      attemptedStrategies,
    }
  }

  // Strategy 2: Line ending normalized match
  attemptedStrategies.push('line_ending_normalized')
  const normalizedContent = normalizeLineEndings(content)
  const normalizedPattern = normalizeLineEndings(processedPattern)
  const lineEndingIndex = normalizedContent.indexOf(normalizedPattern)
  if (lineEndingIndex !== -1) {
    // Map both normalized start/end indices back to original content.
    const actualStartIndex = mapNormalizedIndexToOriginal(content, lineEndingIndex)
    const actualEndIndex = mapNormalizedIndexToOriginal(
      content,
      lineEndingIndex + normalizedPattern.length
    )
    const matchedText = content.substring(actualStartIndex, actualEndIndex)
    return {
      found: true,
      startIndex: actualStartIndex,
      endIndex: actualEndIndex,
      matchedText,
      strategy: 'line_ending_normalized',
      attemptedStrategies,
    }
  }

  // Strategy 3: Whitespace normalized match
  attemptedStrategies.push('whitespace_normalized')
  const wsNormalizedContent = normalizeWhitespace(normalizedContent)
  const wsNormalizedPattern = normalizeWhitespace(normalizedPattern)
  const wsIndex = wsNormalizedContent.indexOf(wsNormalizedPattern)
  if (wsIndex !== -1) {
    // Find the actual text in original content that matches
    const match = findOriginalTextForNormalizedMatch(content, processedPattern)
    if (match.found) {
      return {
        found: true,
        startIndex: match.startIndex,
        endIndex: match.endIndex,
        matchedText: match.matchedText,
        strategy: 'whitespace_normalized',
        attemptedStrategies,
      }
    }
  }

  // Strategy 4: Fuzzy match (only if enabled)
  if (enableFuzzy) {
    attemptedStrategies.push('fuzzy')
    const fuzzyMatch = findFuzzyMatch(content, processedPattern, fuzzyThreshold)
    if (fuzzyMatch.found) {
      return {
        found: true,
        startIndex: fuzzyMatch.startIndex,
        endIndex: fuzzyMatch.endIndex,
        matchedText: fuzzyMatch.matchedText,
        strategy: 'fuzzy',
        similarity: fuzzyMatch.similarity,
        attemptedStrategies,
      }
    }
  }

  return {
    found: false,
    startIndex: -1,
    endIndex: -1,
    matchedText: '',
    strategy: 'exact',
    attemptedStrategies,
  }
}

/**
 * Find actual position in original string given position in normalized string
 */
function mapNormalizedIndexToOriginal(original: string, normalizedIndex: number): number {
  // Simple approach: count characters accounting for \r\n -> \n conversion
  let originalIndex = 0
  let normalizedCount = 0

  while (normalizedCount < normalizedIndex && originalIndex < original.length) {
    if (original[originalIndex] === '\r' && original[originalIndex + 1] === '\n') {
      originalIndex += 2
      normalizedCount += 1
    } else {
      originalIndex += 1
      normalizedCount += 1
    }
  }

  return originalIndex
}

function getLineStartIndices(lines: string[]): number[] {
  const starts: number[] = []
  let offset = 0

  for (let i = 0; i < lines.length; i++) {
    starts.push(offset)
    offset += lines[i].length
    if (i < lines.length - 1) {
      offset += 1 // account for normalized \n separator
    }
  }

  return starts
}

/**
 * Find original text that matches a whitespace-normalized pattern
 */
function findOriginalTextForNormalizedMatch(
  content: string,
  pattern: string
): { found: boolean; startIndex: number; endIndex: number; matchedText: string } {
  const normalizedContent = normalizeLineEndings(content)
  const normalizedPattern = normalizeLineEndings(pattern)
  const patternLines = normalizedPattern.split('\n')
  const contentLines = normalizedContent.split('\n')
  const patternNormalizedLines = patternLines.map(normalizeWhitespaceLine)
  const contentLineStarts = getLineStartIndices(contentLines)

  for (let i = 0; i <= contentLines.length - patternLines.length; i++) {
    let matches = true
    for (let j = 0; j < patternLines.length; j++) {
      if (normalizeWhitespaceLine(contentLines[i + j]) !== patternNormalizedLines[j]) {
        matches = false
        break
      }
    }

    if (matches) {
      const normalizedStart = contentLineStarts[i]
      const lastLineIndex = i + patternLines.length - 1
      const normalizedEnd = contentLineStarts[lastLineIndex] + contentLines[lastLineIndex].length
      const startIndex = mapNormalizedIndexToOriginal(content, normalizedStart)
      const endIndex = mapNormalizedIndexToOriginal(content, normalizedEnd)
      const matchedText = content.substring(startIndex, endIndex)

      return { found: true, startIndex, endIndex, matchedText }
    }
  }

  return { found: false, startIndex: -1, endIndex: -1, matchedText: '' }
}

export default editFile
