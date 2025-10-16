// ygg-chat/server/src/utils/tools/core/editFileAst.ts
// Lightweight AST editing utilities using Tree-sitter.
// Supports generic query-driven edits: replace, insert, delete.
// Grammars are loaded dynamically; install the appropriate language packages, e.g.:
//   npm i tree-sitter-typescript tree-sitter-javascript tree-sitter-json

import fs from 'fs'
import path from 'path'
import { default as Language, default as Parser, Query, SyntaxNode } from 'tree-sitter'

export type SupportedLanguage = 'typescript' | 'tsx' | 'javascript' | 'jsx' | 'json'

export type ReplaceOp = {
  type: 'replace'
  query: string // Tree-sitter query string
  capture: string // capture name to replace, e.g. 'target'
  replacement: string
  all?: boolean // if false, only first match is replaced
}

export type InsertOp = {
  type: 'insert'
  query: string
  capture: string
  position: 'before' | 'after' | 'start' | 'end' // relative to capture node
  text: string
}

export type DeleteOp = {
  type: 'delete'
  query: string
  capture: string
  all?: boolean
}

export type AstEditOperation = ReplaceOp | InsertOp | DeleteOp

export interface EditFileAstOptions {
  language?: SupportedLanguage
  dryRun?: boolean
}

export interface EditFileAstResult {
  language: SupportedLanguage
  applied: boolean
  changed: boolean
  edits: number
  path: string
  absolutePath: string
  originalSize: number
  newSize: number
  newContent?: string // included when dryRun is true
  details: Array<{ opIndex: number; description: string; count: number }>
}

// Dynamically load a Tree-sitter language grammar
async function loadLanguageGrammar(lang: SupportedLanguage): Promise<Language> {
  try {
    if (lang === 'typescript' || lang === 'tsx') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ts = require('tree-sitter-typescript')
      const grammar: Language = lang === 'tsx' ? ts.tsx : ts.typescript
      if (!grammar) throw new Error('tree-sitter-typescript did not export the expected language')
      return grammar
    }
    if (lang === 'javascript' || lang === 'jsx') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const js = require('tree-sitter-javascript')
      const grammar: Language = js
      if (!grammar) throw new Error('tree-sitter-javascript did not export the expected language')
      return grammar
    }
    if (lang === 'json') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const json = require('tree-sitter-json')
      const grammar: Language = json
      if (!grammar) throw new Error('tree-sitter-json did not export the expected language')
      return grammar
    }
  } catch (err: any) {
    const msg = String(err?.message || err || '')
    throw new Error(
      `Missing or incompatible grammar for '${lang}'. Install the required packages: ` +
        `npm i tree-sitter-typescript tree-sitter-javascript tree-sitter-json\nInner error: ${msg}`
    )
  }
  throw new Error(`Unsupported language: ${lang}`)
}

function detectLanguageFromPath(filePath: string): SupportedLanguage | null {
  const lowered = filePath.toLowerCase()
  if (lowered.endsWith('.tsx')) return 'tsx'
  if (lowered.endsWith('.ts')) return 'typescript'
  if (lowered.endsWith('.jsx')) return 'jsx'
  if (lowered.endsWith('.js')) return 'javascript'
  if (lowered.endsWith('.json')) return 'json'
  return null
}

function applyTextEdits(
  content: string,
  edits: Array<{ startIndex: number; endIndex: number; newText: string }>
): string {
  // Apply edits in descending order of startIndex to preserve ranges
  const sorted = [...edits].sort((a, b) => b.startIndex - a.startIndex)
  let out = content
  for (const e of sorted) {
    out = out.slice(0, e.startIndex) + e.newText + out.slice(e.endIndex)
  }
  return out
}

function toOffset(node: SyntaxNode): { start: number; end: number } {
  // startIndex/endIndex are byte offsets in JS binding; content is UTF-16 string.
  // In practice, this works with standard ASCII/UTF-8 text for edits
  return { start: node.startIndex, end: node.endIndex }
}

function runQuery(lang: Language, root: SyntaxNode, query: string): Array<Record<string, SyntaxNode>> {
  const q = new Query(lang, query)
  const matches = q.matches(root)
  const results: Array<Record<string, SyntaxNode>> = []
  for (const m of matches) {
    const capMap: Record<string, SyntaxNode> = {}
    for (const cap of m.captures) {
      // cap has shape { name: string, node: SyntaxNode }
      capMap[cap.name] = cap.node
    }
    results.push(capMap)
  }
  return results
}

export async function editFileAst(
  inputPath: string,
  operations: AstEditOperation[],
  options: EditFileAstOptions = {}
): Promise<EditFileAstResult> {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('No operations provided')
  }

  const abs = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath)
  const original = await fs.promises.readFile(abs, 'utf8')
  const language = options.language || detectLanguageFromPath(abs) || 'typescript'

  const parser = new Parser()
  const grammar = await loadLanguageGrammar(language)
  parser.setLanguage(grammar)
  const tree = parser.parse(original)
  const root = tree.rootNode

  const edits: Array<{ startIndex: number; endIndex: number; newText: string; desc: string; opIndex: number }> = []
  const details: Array<{ opIndex: number; description: string; count: number }> = []

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]
    if (op.type === 'replace') {
      const results = runQuery(grammar, root, op.query)
      let count = 0
      for (const cap of results) {
        const node = cap[op.capture]
        if (!node) continue
        const { start, end } = toOffset(node)
        edits.push({
          startIndex: start,
          endIndex: end,
          newText: op.replacement,
          desc: `replace ${op.capture}`,
          opIndex: i,
        })
        count++
        if (!op.all) break
      }
      details.push({ opIndex: i, description: 'replace', count })
    } else if (op.type === 'insert') {
      const results = runQuery(grammar, root, op.query)
      let count = 0
      for (const cap of results) {
        const node = cap[op.capture]
        if (!node) continue
        const { start, end } = toOffset(node)
        let startIndex = start
        let endIndex = start
        if (op.position === 'after') {
          startIndex = end
          endIndex = end
        } else if (op.position === 'start') {
          startIndex = start
          endIndex = start
        } else if (op.position === 'end') {
          startIndex = end
          endIndex = end
        }
        edits.push({ startIndex, endIndex, newText: op.text, desc: `insert ${op.position}`, opIndex: i })
        count++
      }
      details.push({ opIndex: i, description: 'insert', count })
    } else if (op.type === 'delete') {
      const results = runQuery(grammar, root, op.query)
      let count = 0
      for (const cap of results) {
        const node = cap[op.capture]
        if (!node) continue
        const { start, end } = toOffset(node)
        edits.push({ startIndex: start, endIndex: end, newText: '', desc: `delete ${op.capture}`, opIndex: i })
        count++
        if (!op.all) break
      }
      details.push({ opIndex: i, description: 'delete', count })
    }
  }

  const changed = edits.length > 0
  const newContent = changed ? applyTextEdits(original, edits) : original

  const applied = !options.dryRun && changed
  if (applied) {
    await fs.promises.writeFile(abs, newContent, 'utf8')
  }

  return {
    language,
    applied,
    changed,
    edits: edits.length,
    path: inputPath,
    absolutePath: abs,
    originalSize: original.length,
    newSize: newContent.length,
    newContent: options.dryRun ? newContent : undefined,
    details,
  }
}

export default editFileAst
