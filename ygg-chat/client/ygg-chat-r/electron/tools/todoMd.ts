import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { Config, uniqueNamesGenerator } from 'unique-names-generator'

const TODO_DIR_NAME = 'todos'
const TODO_FILE_EXTENSION = '.md'
const ID_DICTIONARY = [
  'ember',
  'atlas',
  'sage',
  'haven',
  'lumen',
  'quill',
  'cinder',
  'aurora',
  'drift',
  'marble',
  'pioneer',
  'fern',
  'opal',
  'orbit',
  'spark',
  'basil',
  'cascade',
  'north',
  'horizon',
  'goku',
  'vegeta',
  'piccolo',
  'gohan',
  'freeza',
  'cell',
  'bulma',
  'trunks',
  'broly',
]
const MAX_ID_ATTEMPTS = 12

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
  const trimmed = rawId.trim().toLowerCase()
  if (!trimmed || /[^a-z0-9-]/.test(trimmed) || trimmed.startsWith('-') || trimmed.endsWith('-')) {
    throw new Error('Todo id must be lowercase alphanumeric words separated by dashes')
  }
  return trimmed
}

async function ensureStorageDirectory(): Promise<string> {
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
      .filter(entry => entry.endsWith(TODO_FILE_EXTENSION))
      .map(entry => entry.slice(0, -TODO_FILE_EXTENSION.length))
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

export async function writeTodoList(content: string): Promise<WriteTodoResult> {
  const generatedId = await generateTodoId()
  const dir = await ensureStorageDirectory()
  const filePath = path.join(dir, `${generatedId}${TODO_FILE_EXTENSION}`)

  await fs.writeFile(filePath, content, 'utf8')
  return { id: generatedId, path: filePath }
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

  throw new Error('Unable to generate a unique todo ID after multiple attempts')
}

export function configureTodoStorageDirectory(directory: string): void {
  overrideBaseDir = path.resolve(directory)
}

export function getTodoStorageDirectory(): string {
  return getTodoDirectory()
}
