// server/src/database/idGenerator.ts
import { v4 as uuidv4 } from 'uuid'

/**
 * Generate a new UUID v4 for database primary keys
 */
export function generateId(): string {
  return uuidv4()
}

/**
 * Validate if a string is a valid UUID
 */
export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(id)
}

/**
 * Validate and sanitize an ID parameter from API requests
 * @throws Error if ID is invalid
 */
export function validateId(id: any, paramName: string = 'id'): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`Invalid ${paramName}: must be a non-empty string`)
  }

  const trimmedId = id.trim()

  if (!isValidUUID(trimmedId)) {
    throw new Error(`Invalid ${paramName}: must be a valid UUID`)
  }

  return trimmedId
}
