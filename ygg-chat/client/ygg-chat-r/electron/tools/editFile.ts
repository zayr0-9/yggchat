import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { readTextFile, FileMetadata } from './readFile.js'
import { isWSLPath, resolveToWindowsPath, toWslPath } from '../utils/wslBridge.js'

export interface EditFileOptions {
  createBackup?: boolean
  encoding?: BufferEncoding
  enableFuzzyMatching?: boolean // Enable layered matching strategies (default: true)
  fuzzyThreshold?: number // Similarity threshold for fuzzy matching (default: 0.8)
  preserveIndentation?: boolean // Preserve original indentation style (default: true)
  operationMode?: 'plan' | 'execute'
  validateContent?: boolean // Validate file hasn't changed since read (default: true)
  expectedHash?: string // Expected content hash from previous read
  expectedMetadata?: FileMetadata // Expected file metadata from previous read
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
  absolutePath: string
  sizeBytes: number
  replacements: number
  message: string
  backup?: string
  matchStrategy?: MatchStrategy // Which strategy succeeded
  attemptedStrategies?: string[] // For debugging failed matches
  validation?: FileValidationResult // Validation result if performed
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
    validateContent = true,
  } = options

  try {
    // Read the file first
    const fileData = await readTextFile(filePath)
    const originalContent = fileData.content
    const absolutePath = fileData.absolutePath

    // Validate file content if requested
    let validation: FileValidationResult | undefined
    if (validateContent) {
      validation = await validateFileContent(absolutePath, originalContent, options)
      if (!validation.valid) {
        return {
          success: false,
          absolutePath: toWslPath(absolutePath),
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

    if (searchPattern === replacement) {
      // No change needed
      newContent = originalContent
      replacements = 0
    } else {
      // Try layered matching strategies
      const matchResult = findMatchWithStrategies(
        originalContent,
        searchPattern,
        enableFuzzyMatching,
        fuzzyThreshold
      )
      attemptedStrategies = matchResult.attemptedStrategies

      if (!matchResult.found) {
        return {
          success: false,
          absolutePath: toWslPath(absolutePath),
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

      // For global replacement, we need to handle multiple occurrences
      // First, count all exact matches
      const exactRegex = new RegExp(escapeRegExp(searchPattern), 'g')
      const exactMatches = originalContent.match(exactRegex)

      if (exactMatches && exactMatches.length > 0) {
        // If exact matches exist, use traditional global replacement
        replacements = exactMatches.length
        newContent = originalContent.replace(exactRegex, finalReplacement)
      } else {
        // Use the matched text from layered strategy for single replacement
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
      backupPath = `${absolutePath}.backup.${timestamp}`
      await fs.promises.writeFile(backupPath, originalContent, encoding)
    }

    // Write the modified content back to file
    if (replacements > 0) {
      await fs.promises.writeFile(absolutePath, newContent, encoding)
    }

    // Get new file size
    const newStats = await fs.promises.stat(absolutePath)

    const strategyMessage =
      matchStrategy && matchStrategy !== 'exact'
        ? ` (matched using ${matchStrategy} strategy)`
        : ''

    return {
      success: true,
      absolutePath: toWslPath(absolutePath),
      sizeBytes: newStats.size,
      replacements,
      message:
        replacements > 0
          ? `Successfully replaced ${replacements} occurrence(s)${strategyMessage} in ${filePath}`
          : `No changes needed in ${filePath}`,
      backup: backupPath ? toWslPath(backupPath) : undefined,
      matchStrategy,
      attemptedStrategies,
      validation,
    }
  } catch (error: any) {
    return {
      success: false,
      absolutePath: '',
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
    validateContent = true,
  } = options

  try {
    const fileData = await readTextFile(filePath)
    const originalContent = fileData.content
    const absolutePath = fileData.absolutePath

    // Validate file content if requested
    let validation: FileValidationResult | undefined
    if (validateContent) {
      validation = await validateFileContent(absolutePath, originalContent, options)
      if (!validation.valid) {
        return {
          success: false,
          absolutePath: toWslPath(absolutePath),
          sizeBytes: fileData.sizeBytes,
          replacements: 0,
          message: `Validation failed: ${validation.reason}`,
          validation,
        }
      }
    }

    // Try layered matching strategies
    const matchResult = findMatchWithStrategies(
      originalContent,
      searchPattern,
      enableFuzzyMatching,
      fuzzyThreshold
    )

    if (!matchResult.found) {
      return {
        success: false,
        absolutePath: toWslPath(absolutePath),
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

    const newContent =
      originalContent.substring(0, matchResult.startIndex) +
      finalReplacement +
      originalContent.substring(matchResult.endIndex)

    // Create backup if requested
    let backupPath: string | undefined
    if (createBackup) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      backupPath = `${absolutePath}.backup.${timestamp}`
      await fs.promises.writeFile(backupPath, originalContent, encoding)
    }

    // Write the modified content
    await fs.promises.writeFile(absolutePath, newContent, encoding)

    const newStats = await fs.promises.stat(absolutePath)

    const strategyMessage =
      matchResult.strategy !== 'exact' ? ` (matched using ${matchResult.strategy} strategy)` : ''

    return {
      success: true,
      absolutePath: toWslPath(absolutePath),
      sizeBytes: newStats.size,
      replacements: 1,
      message: `Successfully replaced first occurrence${strategyMessage} in ${filePath}`,
      backup: backupPath ? toWslPath(backupPath) : undefined,
      matchStrategy: matchResult.strategy,
      attemptedStrategies: matchResult.attemptedStrategies,
      validation,
    }
  } catch (error: any) {
    return {
      success: false,
      absolutePath: '',
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
    let absolutePath = filePath
    if (isWSLPath(filePath)) {
      absolutePath = await resolveToWindowsPath(filePath)
    } else {
      absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)
    }

    let originalContent = ''
    let fileExists = true

    try {
      const fileData = await readTextFile(filePath)
      originalContent = fileData.content
      // Update absolutePath from read result just in case
      absolutePath = fileData.absolutePath
    } catch {
      fileExists = false
    }

    // Create backup if file exists and backup requested
    let backupPath: string | undefined
    if (createBackup && fileExists) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      backupPath = `${absolutePath}.backup.${timestamp}`
      await fs.promises.writeFile(backupPath, originalContent, encoding)
    }

    // Append content
    await fs.promises.appendFile(absolutePath, content, encoding)

    const newStats = await fs.promises.stat(absolutePath)

    return {
      success: true,
      absolutePath: toWslPath(absolutePath),
      sizeBytes: newStats.size,
      replacements: 1, // Consider append as one "replacement"
      message: `Successfully appended content to ${filePath}`,
      backup: backupPath ? toWslPath(backupPath) : undefined,
    }
  } catch (error: any) {
    return {
      success: false,
      absolutePath: '',
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
      absolutePath: filePath,
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
          absolutePath: '',
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
          absolutePath: '',
          sizeBytes: 0,
          replacements: 0,
          message: 'searchPattern and replacement are required for replace_first operation',
        }
      }
      return editFileSearchReplaceFirst(filePath, searchPattern, replacement, options)

    case 'append':
      if (!content) {
        return {
          success: false,
          absolutePath: '',
          sizeBytes: 0,
          replacements: 0,
          message: 'content is required for append operation',
        }
      }
      return appendToFile(filePath, content, options)

    default:
      return {
        success: false,
        absolutePath: '',
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
    .map(line => line.trim().replace(/\s+/g, ' '))
    .join('\n')
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
      const relativeIndent = lineIndent.length - replacementBaseIndent.length

      // Apply original base indent plus relative indent
      const newIndent = baseIndent + ' '.repeat(Math.max(0, relativeIndent))
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
  fuzzyThreshold: number = 0.8
): MatchResult & { attemptedStrategies: string[] } {
  const attemptedStrategies: string[] = []

  // Strategy 1: Exact match
  attemptedStrategies.push('exact')
  const exactIndex = content.indexOf(pattern)
  if (exactIndex !== -1) {
    return {
      found: true,
      startIndex: exactIndex,
      endIndex: exactIndex + pattern.length,
      matchedText: pattern,
      strategy: 'exact',
      attemptedStrategies,
    }
  }

  // Strategy 2: Line ending normalized match
  attemptedStrategies.push('line_ending_normalized')
  const normalizedContent = normalizeLineEndings(content)
  const normalizedPattern = normalizeLineEndings(pattern)
  const lineEndingIndex = normalizedContent.indexOf(normalizedPattern)
  if (lineEndingIndex !== -1) {
    // Find the actual position in original content
    const actualStartIndex = findActualPosition(content, lineEndingIndex)
    const matchedText = content.substring(
      actualStartIndex,
      actualStartIndex + normalizedPattern.length
    )
    return {
      found: true,
      startIndex: actualStartIndex,
      endIndex: actualStartIndex + matchedText.length,
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
    const match = findOriginalTextForNormalizedMatch(content, pattern)
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
    const fuzzyMatch = findFuzzyMatch(content, pattern, fuzzyThreshold)
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
function findActualPosition(original: string, normalizedIndex: number): number {
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

/**
 * Find original text that matches a whitespace-normalized pattern
 */
function findOriginalTextForNormalizedMatch(
  content: string,
  pattern: string
): { found: boolean; startIndex: number; endIndex: number; matchedText: string } {
  const patternLines = normalizeLineEndings(pattern).split('\n')
  const contentLines = normalizeLineEndings(content).split('\n')

  // Try to match line by line with trimmed content
  const patternTrimmed = patternLines.map(l => l.trim())

  for (let i = 0; i <= contentLines.length - patternLines.length; i++) {
    let matches = true
    for (let j = 0; j < patternLines.length; j++) {
      if (contentLines[i + j].trim() !== patternTrimmed[j]) {
        matches = false
        break
      }
    }

    if (matches) {
      // Calculate actual indices
      const linesBeforeMatch = contentLines.slice(0, i).join('\n')
      const startIndex = linesBeforeMatch.length + (i > 0 ? 1 : 0)
      const matchedText = contentLines.slice(i, i + patternLines.length).join('\n')
      const endIndex = startIndex + matchedText.length

      return { found: true, startIndex, endIndex, matchedText }
    }
  }

  return { found: false, startIndex: -1, endIndex: -1, matchedText: '' }
}

export default editFile
