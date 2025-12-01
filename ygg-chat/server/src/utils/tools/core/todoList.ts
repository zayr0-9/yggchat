import fs from 'fs/promises'
import path from 'path'
import { Config, uniqueNamesGenerator } from 'unique-names-generator'

const TODO_FOLDER_NAME = 'todos'
const TODO_FILE_EXTENSION = '.md'
const ID_DICTIONARY = ['ember', 'atlas', 'sage', 'haven', 'lumen', 'quill', 'cinder', 'aurora', 'drift', 'marble', 'pioneer', 'fern', 'opal', 'orbit', 'spark', 'basil', 'cascade', 'north', 'horizon']
const MAX_ID_ATTEMPTS = 12

function resolveBaseDirectory(): string {
  const env = process.env.YGG_TODO_DIRECTORY?.trim()
  if (env) {
    return path.resolve(env)
  }

  return path.resolve(process.cwd(), '.ygg-chat-todos')
}

function getTodoDirectory(): string {
  return path.join(resolveBaseDirectory(), TODO_FOLDER_NAME)
}

function normalizeId(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed || /[^a-z0-9-]/.test(trimmed) || trimmed.startsWith('-') || trimmed.endsWith('-')) {
    throw new Error('Todo id must be lowercase and dash-separated')
  }
  return trimmed
}

async function ensureDirectoryExists(): Promise<string> {
  const dir = getTodoDirectory()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export interface ReadTodoResult {
  id: string
  path: string
  exists: boolean
  content: string | null
}

export interface WriteTodoResult {
  id: string
  path: string
}

export async function listTodoIds(): Promise<string[]> {
  const dir = getTodoDirectory()
  try {
    const entries = await fs.readdir(dir)
    return entries
      .filter(f => f.endsWith(TODO_FILE_EXTENSION))
      .map(f => f.slice(0, -TODO_FILE_EXTENSION.length))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

export async function readTodoList(id: string): Promise<ReadTodoResult> {
  const sanitized = normalizeId(id)
  const filePath = path.join(getTodoDirectory(), `${sanitized}${TODO_FILE_EXTENSION}`)

  try {
    const content = await fs.readFile(filePath, 'utf8')
    return { id: sanitized, path: filePath, exists: true, content }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { id: sanitized, path: filePath, exists: false, content: null }
    }
    throw error
  }
}

export async function writeTodoList(id: string, content: string): Promise<WriteTodoResult> {
  const sanitized = normalizeId(id)
  const dir = await ensureDirectoryExists()
  const filePath = path.join(dir, `${sanitized}${TODO_FILE_EXTENSION}`)
  await fs.writeFile(filePath, content, 'utf8')
  return { id: sanitized, path: filePath }
}

const uniqueIdConfig: Config = {
  dictionaries: [ID_DICTIONARY],
  separator: '-',
  style: 'lowerCase',
  length: 3,
}

export async function generateTodoId(): Promise<string> {
  const existing = new Set(await listTodoIds())

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const candidate = uniqueNamesGenerator(uniqueIdConfig)
    if (!existing.has(candidate)) {
      return candidate
    }
  }

  throw new Error('Unable to generate a unique todo id after multiple attempts')
}

export function getTodoStorageDirectory(): string {
  return getTodoDirectory()
}
