import fs from 'fs/promises';
import path from 'path';

/**
 * Deletes a file at the specified path
 * @param filePath - Absolute or relative path to the file to delete
 * @returns Promise<void>
 * @throws Error if file doesn't exist or deletion fails
 */
export async function deleteFile(filePath: string): Promise<void> {
  try {
    // Resolve the path to handle relative paths
    const resolvedPath = path.resolve(filePath);
    
    // Check if file exists
    try {
      await fs.access(resolvedPath);
    } catch {
      throw new Error(`File not found: ${resolvedPath}`);
    }
    
    // Delete the file
    await fs.unlink(resolvedPath);
    
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
    throw new Error('Failed to delete file: Unknown error');
  }
}

/**
 * Safely deletes a file with additional validation
 * @param filePath - Path to the file to delete
 * @param allowedExtensions - Optional array of allowed file extensions
 * @returns Promise<void>
 * @throws Error if validation fails or deletion fails
 */
export async function safeDeleteFile(
  filePath: string, 
  allowedExtensions?: string[]
): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  
  // Validate file extension if provided
  if (allowedExtensions && allowedExtensions.length > 0) {
    const fileExt = path.extname(resolvedPath).toLowerCase();
    if (!allowedExtensions.some(ext => ext.toLowerCase() === fileExt)) {
      throw new Error(
        `File extension '${fileExt}' not allowed. Allowed extensions: ${allowedExtensions.join(', ')}`
      );
    }
  }
  
  // Prevent deletion of sensitive system files/directories
  const sensitivePatterns = [
    '/etc/passwd',
    '/etc/shadow',
    '/proc',
    '/sys',
    '/dev',
    '.env',
    '.git',
    'node_modules'
  ];
  
  const normalizedPath = path.normalize(resolvedPath);
  if (sensitivePatterns.some(pattern => normalizedPath.includes(pattern))) {
    throw new Error(`Cannot delete sensitive system file or directory: ${resolvedPath}`);
  }
  
  // Use the basic delete function
  await deleteFile(resolvedPath);
}

export default {
  deleteFile,
  safeDeleteFile
};