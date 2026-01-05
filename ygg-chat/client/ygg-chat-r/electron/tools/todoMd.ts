import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { Config, uniqueNamesGenerator } from 'unique-names-generator'

const TODO_DIR_NAME = 'todos'
const TODO_FILE_EXTENSION = '.md'
const MAX_LIST_RESULTS = 5
const MAX_ID_ATTEMPTS = 12

const ID_DICTIONARY = [
  'ember', 'atlas', 'sage', 'haven', 'lumen', 'quill', 'cinder', 'aurora',
  'drift', 'marble', 'pioneer', 'fern', 'opal', 'orbit', 'spark', 'basil',
  'cascade', 'north', 'horizon', 'goku', 'vegeta', 'piccolo', 'gohan',
  'freeza', 'cell', 'bulma', 'trunks', 'broly', 'gurren', 'lagann'
]

let overrideBaseDir: string | null = null
let cachedBaseDir: string | null = null

function resolveBaseDir(): string {
  if (overrideBaseDir) {
    return overrideBaseDir
  }

  if (cachedBaseDir) {
    return cachedBaseDir
  }

  const envOverride = process.env.YGG_TODO_DIRECTORY?.trim()
  if (envOverride) {
    cachedBaseDir = path.resolve(envOverride)
    return cachedBaseDir
  }

  try {
    cachedBaseDir = app.getPath('userData')
  } catch (error) {
    cachedBaseDir = path.resolve(process.cwd(), '.ygg-chat-r', 'todos-storage')
  }

  return cachedBaseDir
}

function getTodoDirectory(): string {
  return path.join(resolveBaseDir(), TODO_DIR_NAME)
}

function normalizeId(rawId: string): string {
  const trimmed = rawId.trim().toLowerCase().replace(/\s+/g, '-')
  if (!trimmed || /[^a-z0-9-]/.test(trimmed) || trimmed.startsWith('-') || trimmed.endsWith('-')) {
    throw new Error('Todo name must be lowercase alphanumeric with dashes (e.g., "my-project-tasks")')
  }
  return trimmed
}

async function ensureStorageDirectory(): Promise<string> {
  const dir = getTodoDirectory()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export interface TodoListInfo {
  id: string
  modifiedAt: string
}

export interface ReadTodoResult {
  exists: boolean
  content: string | null
}

export interface CreateTodoResult {
  id: string
  created: boolean
  content: string
}

export interface EditTodoResult {
  success: boolean
  message: string
  content: string | null
}

/**
 * List todo files, sorted by most recent first, limited to MAX_LIST_RESULTS
 */
export async function listTodoLists(): Promise<TodoListInfo[]> {
  const dir = getTodoDirectory()
  try {
    const entries = await fs.readdir(dir)
    const todoFiles = entries.filter(f => f.endsWith(TODO_FILE_EXTENSION))

    // Get stats for each file to sort by modification time
    const filesWithStats = await Promise.all(
      todoFiles.map(async f => {
        const filePath = path.join(dir, f)
        const stats = await fs.stat(filePath)
        return {
          name: f.slice(0, -TODO_FILE_EXTENSION.length),
          path: filePath,
          modifiedAt: stats.mtime.toISOString(),
          mtime: stats.mtime.getTime(),
        }
      })
    )

    // Sort by most recent first, limit to MAX_LIST_RESULTS
    return filesWithStats
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_LIST_RESULTS)
      .map(({ name, modifiedAt }) => ({ id: name, modifiedAt }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

/**
 * Read a todo list by name
 */
export async function readTodoList(name: string): Promise<ReadTodoResult> {
  const sanitized = normalizeId(name)
  const filePath = path.join(getTodoDirectory(), `${sanitized}${TODO_FILE_EXTENSION}`)

  try {
    const content = await fs.readFile(filePath, 'utf8')
    return { exists: true, content }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, content: null }
    }
    throw error
  }
}

/**
 * Generate a unique todo ID using the dictionary
 */
async function generateTodoId(): Promise<string> {
  const dir = getTodoDirectory()
  let existingIds: string[] = []
  try {
    const entries = await fs.readdir(dir)
    existingIds = entries
      .filter(f => f.endsWith(TODO_FILE_EXTENSION))
      .map(f => f.slice(0, -TODO_FILE_EXTENSION.length))
  } catch {
    // Directory doesn't exist yet, no conflicts
  }

  const existing = new Set(existingIds)
  const config: Config = {
    dictionaries: [ID_DICTIONARY, ID_DICTIONARY, ID_DICTIONARY],
    separator: '-',
    style: 'lowerCase',
    length: 3,
  }

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const candidate = uniqueNamesGenerator(config)
    if (!existing.has(candidate)) {
      return candidate
    }
  }

  throw new Error('Unable to generate a unique todo id after multiple attempts')
}

/**
 * Create a new todo list with auto-generated name
 */
export async function createTodoList(content: string): Promise<CreateTodoResult> {
  const generatedName = await generateTodoId()
  const dir = await ensureStorageDirectory()
  const filePath = path.join(dir, `${generatedName}${TODO_FILE_EXTENSION}`)

  await fs.writeFile(filePath, content, 'utf8')
  return { id: generatedName, created: true, content }
}

/**
 * Edit a todo list by finding a line and replacing it
 * @param name - The todo list name
 * @param search - The text to search for (matches line containing this text)
 * @param replacement - The replacement text (replaces entire line)
 */
export async function editTodoList(
  name: string,
  search: string,
  replacement: string
): Promise<EditTodoResult> {
  const sanitized = normalizeId(name)
  const filePath = path.join(getTodoDirectory(), `${sanitized}${TODO_FILE_EXTENSION}`)

  try {
    const content = await fs.readFile(filePath, 'utf8')
    const lines = content.split('\n')
    let matchCount = 0

    const newLines = lines.map(line => {
      if (line.includes(search)) {
        matchCount++
        return replacement
      }
      return line
    })

    if (matchCount === 0) {
      return {
        success: false,
        message: `No lines found containing "${search}"`,
        content,
      }
    }

    const newContent = newLines.join('\n')
    await fs.writeFile(filePath, newContent, 'utf8')
    return {
      success: true,
      message: `Updated`,
      content: newContent,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        success: false,
        message: `Todo list "${sanitized}" does not exist`,
        content: null,
      }
    }
    throw error
  }
}

export function configureTodoStorageDirectory(directory: string): void {
  overrideBaseDir = path.resolve(directory)
}

export function getTodoStorageDirectory(): string {
  return getTodoDirectory()
}
