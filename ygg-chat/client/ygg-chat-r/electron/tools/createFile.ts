import * as fs from 'fs'
import * as path from 'path'
import { isWSLPath, resolveToWindowsPath } from '../utils/wslBridge.js'

export interface CreateFileOptions {
  directory?: string
  createParentDirs?: boolean
  overwrite?: boolean
  executable?: boolean
  operationMode?: 'plan' | 'execute'
  cwd?: string // Workspace directory for path resolution and restriction
}

export interface CreateFileResult {
  success: boolean
  created: boolean
  sizeBytes: number
  message: string
}

/**
 * Create a file with the specified content.
 * Supports automatic parent directory creation and optional overwrite.
 * 
 * @param filePath - The path to the file (absolute or relative)
 * @param content - The content to write to the file
 * @param options - Optional settings for file creation
 * @returns Promise<CreateFileResult>
 */
export async function createTextFile(
  filePath: string,
  content: string = '',
  options: CreateFileOptions = {}
): Promise<CreateFileResult> {
  const {
    directory,
    createParentDirs = true,
    overwrite = false,
    executable = false,
    operationMode,
    cwd,
  } = options

  // Block file creation in plan mode
  if (operationMode === 'plan') {
    return {
      success: false,
      created: false,
      sizeBytes: 0,
      message: 'You are in planning mode. File creation is not allowed. Please describe your implementation plan instead.',
    }
  }

  try {
    // Determine the target path
    let targetPath: string
    let isWSL = false

    if (directory && isWSLPath(directory)) {
      isWSL = true
      // Join manually for WSL paths to avoid backslash issues
      if (isWSLPath(filePath)) { // Absolute WSL path
        targetPath = filePath
      } else {
        // Assume relative path, simple join
        targetPath = directory.replace(/\/$/, '') + '/' + filePath
      }
    } else if (isWSLPath(filePath)) {
      isWSL = true
      targetPath = filePath
    } else {
      // Standard logic
      if (!path.isAbsolute(filePath) && directory) {
        targetPath = path.resolve(directory, filePath)
      } else if (!path.isAbsolute(filePath)) {
        const basePath = directory || cwd || process.cwd()
        targetPath = path.resolve(basePath, filePath)
      } else {
        targetPath = filePath
      }
    }

    let windowsPath = targetPath
    if (isWSL) {
      windowsPath = await resolveToWindowsPath(targetPath)
    }

    // Workspace validation BEFORE UNC conversion (compare Linux to Linux for WSL)
    if (cwd) {
      if (isWSL) {
        // Both are Linux paths - compare directly using POSIX rules
        const normalizedCwd = cwd.replace(/\/$/, '')
        const normalizedTarget = targetPath.replace(/\/$/, '')
        if (!normalizedTarget.startsWith(normalizedCwd + '/') && normalizedTarget !== normalizedCwd) {
          return {
            success: false,
            created: false,
            sizeBytes: 0,
            message: `Access denied: Path '${filePath}' is outside the workspace '${cwd}'. File operations are restricted to the workspace directory.`
          }
        }
      } else {
        // Windows or native paths - use Node's path module
        const normalizedCwd = path.resolve(cwd)
        const normalizedTarget = path.resolve(targetPath)
        if (!normalizedTarget.startsWith(normalizedCwd + path.sep) && normalizedTarget !== normalizedCwd) {
          return {
            success: false,
            created: false,
            sizeBytes: 0,
            message: `Access denied: Path '${filePath}' is outside the workspace '${cwd}'. File operations are restricted to the workspace directory.`
          }
        }
      }
    }

    // Check if file already exists
    const fileExists = await fs.promises
      .access(windowsPath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false)

    if (fileExists && !overwrite) {
      return {
        success: false,
        created: false,
        sizeBytes: 0,
        message: `File already exists at ${targetPath}. Use overwrite option to replace it.`,
      }
    }

    // Create parent directories if needed
    const parentDir = isWSL ? targetPath.substring(0, targetPath.lastIndexOf('/')) : path.dirname(targetPath)
    let dirsCreated = false

    // We need the windows path for the parent dir too
    let windowsParentDir = parentDir
    if (isWSL) {
      windowsParentDir = await resolveToWindowsPath(parentDir)
    }

    if (createParentDirs) {
      try {
        await fs.promises.mkdir(windowsParentDir, { recursive: true })
        dirsCreated = true
      } catch (mkdirError: any) {
        return {
          success: false,
          created: false,
          sizeBytes: 0,
          message: `Failed to create parent directories: ${mkdirError.message}`,
        }
      }
    } else {
      // Check if parent directory exists
      const dirExists = await fs.promises
        .access(windowsParentDir, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false)

      if (!dirExists) {
        return {
          success: false,
          created: false,
          sizeBytes: 0,
          message: `Parent directory does not exist: ${parentDir}`,
        }
      }
    }

    // Write the file
    await fs.promises.writeFile(windowsPath, content, 'utf8')

    // Make executable if requested and supported by platform
    // If WSL, we should try chmod even if process.platform is win32
    if (executable && (process.platform !== 'win32' || isWSL)) {
      try {
        await fs.promises.chmod(windowsPath, 0o755)
      } catch (chmodError: any) {
        // Non-failure: try to continue even if chmod fails
        console.warn(`Warning: Could not make file executable: ${chmodError.message}`)
      }
    }

    const stats = await fs.promises.stat(windowsPath)

    const message = dirsCreated
      ? `File created successfully at ${targetPath} (parent directories created)`
      : `File created successfully at ${targetPath}`

    return {
      success: true,
      created: true,
      sizeBytes: stats.size,
      message,
    }

  } catch (error: any) {
    return {
      success: false,
      created: false,
      sizeBytes: 0,
      message: `Error creating file: ${error.message}`,
    }
  }
}

export default createTextFile
