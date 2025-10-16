import * as fs from 'fs'
import * as path from 'path'
import { readTextFile } from './readFile'

export interface EditFileOptions {
  createBackup?: boolean
  encoding?: BufferEncoding
}

export type EditOperation = 'replace' | 'replace_first' | 'append'

export interface EditFileResult {
  success: boolean
  absolutePath: string
  sizeBytes: number
  replacements: number
  message: string
  backup?: string
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
  const { createBackup = false, encoding = 'utf8' } = options

  try {
    // Read the file first
    const fileData = await readTextFile(filePath)
    const originalContent = fileData.content
    const absolutePath = fileData.absolutePath

    // Perform search and replace
    let newContent: string
    let replacements: number

    if (searchPattern === replacement) {
      // No change needed
      newContent = originalContent
      replacements = 0
    } else {
      // Use global replacement
      const regex = new RegExp(escapeRegExp(searchPattern), 'g')
      const matches = originalContent.match(regex)
      replacements = matches ? matches.length : 0

      if (replacements === 0) {
        return {
          success: false,
          absolutePath,
          sizeBytes: fileData.sizeBytes,
          replacements: 0,
          message: `Search pattern "${searchPattern}" not found in file`,
        }
      }

      newContent = originalContent.replace(regex, replacement)
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

    return {
      success: true,
      absolutePath,
      sizeBytes: newStats.size,
      replacements,
      message:
        replacements > 0
          ? `Successfully replaced ${replacements} occurrence(s) of "${searchPattern}" in ${filePath}`
          : `No changes needed in ${filePath}`,
      backup: backupPath,
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
  const { createBackup = false, encoding = 'utf8' } = options

  try {
    const fileData = await readTextFile(filePath)
    const originalContent = fileData.content
    const absolutePath = fileData.absolutePath

    const searchIndex = originalContent.indexOf(searchPattern)

    if (searchIndex === -1) {
      return {
        success: false,
        absolutePath,
        sizeBytes: fileData.sizeBytes,
        replacements: 0,
        message: `Search pattern "${searchPattern}" not found in file`,
      }
    }

    const newContent =
      originalContent.substring(0, searchIndex) +
      replacement +
      originalContent.substring(searchIndex + searchPattern.length)

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

    return {
      success: true,
      absolutePath,
      sizeBytes: newStats.size,
      replacements: 1,
      message: `Successfully replaced first occurrence of "${searchPattern}" in ${filePath}`,
      backup: backupPath,
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
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath)

    let originalContent = ''
    let fileExists = true

    try {
      const fileData = await readTextFile(filePath)
      originalContent = fileData.content
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
      absolutePath,
      sizeBytes: newStats.size,
      replacements: 1, // Consider append as one "replacement"
      message: `Successfully appended content to ${filePath}`,
      backup: backupPath,
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
 * Escape special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default editFile
