import { promises as fs } from 'fs'
import * as path from 'path'
import { describe, expect, it, test } from 'vitest'
import { editFile } from '../editFile.js'
import { readTextFile } from '../readFile.js'
import { createToolFsHarness } from './helpers/toolFsHarness.js'

describe('editFile operation contract', () => {
  it('blocks file edits in plan mode', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('plan.txt', 'alpha')

    const result = await editFile('plan.txt', 'replace', {
      searchPattern: 'alpha',
      replacement: 'beta',
      operationMode: 'plan',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('planning mode')
    expect(await harness.readFile('plan.txt')).toBe('alpha')
  })

  it('fails replace when searchPattern is missing', async () => {
    const harness = await createToolFsHarness()

    const result = await editFile('missing-search.txt', 'replace', {
      replacement: 'value',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('searchPattern and replacement are required for replace operation')
  })

  it('fails replace when replacement is missing', async () => {
    const harness = await createToolFsHarness()

    const result = await editFile('missing-replacement.txt', 'replace', {
      searchPattern: 'value',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('searchPattern and replacement are required for replace operation')
  })

  it('fails append when content is undefined', async () => {
    const harness = await createToolFsHarness()

    const result = await editFile('append-missing.txt', 'append', {
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('content is required for append operation')
  })

  it('fails for unknown operation', async () => {
    const harness = await createToolFsHarness()

    const result = await editFile('unknown.txt', 'rename' as any, {
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Unknown operation: rename')
  })
})

describe('editFile replace and replace_first behavior', () => {
  it('replace updates all exact occurrences', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('replace-all.txt', 'foo and foo and baz')

    const result = await editFile('replace-all.txt', 'replace', {
      searchPattern: 'foo',
      replacement: 'bar',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(2)
    expect(result.matchStrategy).toBe('exact')
    expect(await harness.readFile('replace-all.txt')).toBe('bar and bar and baz')
  })

  it('replace_first updates only the first exact occurrence', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('replace-first.txt', 'foo and foo and baz')

    const result = await editFile('replace-first.txt', 'replace_first', {
      searchPattern: 'foo',
      replacement: 'bar',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(await harness.readFile('replace-first.txt')).toBe('bar and foo and baz')
  })

  it('replace is a no-op when processed search and replacement are equivalent', async () => {
    const harness = await createToolFsHarness()
    const original = 'section one\nsection two\n'
    await harness.writeFile('replace-noop.txt', original)

    const result = await editFile('replace-noop.txt', 'replace', {
      searchPattern: 'section one\\nsection two',
      replacement: 'section one\nsection two',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(0)
    expect(result.message).toContain('No changes needed')
    expect(await harness.readFile('replace-noop.txt')).toBe(original)
  })

  it('replace_first is a no-op when replacement equals matched text', async () => {
    const harness = await createToolFsHarness()
    const original = 'alpha\nbeta\n'
    await harness.writeFile('replace-first-noop.txt', original)

    const result = await editFile('replace-first-noop.txt', 'replace_first', {
      searchPattern: 'alpha\\nbeta',
      replacement: 'alpha\nbeta',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(0)
    expect(result.message).toContain('No changes needed')
    expect(await harness.readFile('replace-first-noop.txt')).toBe(original)
  })

  it('replace_first preserves full content for files larger than 200KB', async () => {
    const harness = await createToolFsHarness()
    const search = 'target-marker'
    const replacement = 'target-marker-updated'
    const tailSentinel = 'TAIL-SENTINEL\n'
    const fillerLine = `${'0123456789abcdef'.repeat(16)}\n`
    const original = `HEADER ${search}\n${fillerLine.repeat(900)}${tailSentinel}`
    await harness.writeFile('replace-first-large.txt', original)

    const result = await editFile('replace-first-large.txt', 'replace_first', {
      searchPattern: search,
      replacement,
      cwd: harness.workspaceDir,
    })

    const updated = await harness.readFile('replace-first-large.txt')
    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(updated.startsWith(`HEADER ${replacement}\n`)).toBe(true)
    expect(updated.endsWith(tailSentinel)).toBe(true)
    expect(updated.length).toBe(original.length + (replacement.length - search.length))
  })

  it('replace_first preserves tail when editing the localServer-sized fixture file', async () => {
    const harness = await createToolFsHarness()
    const fixturePath = path.resolve(process.cwd(), 'electron/tools/__tests__/dummyfile.ts.test')
    const original = await fs.readFile(fixturePath, 'utf8')
    const tailSnapshot = original.slice(-12000)

    expect(original.length).toBeGreaterThan(200 * 1024)

    await harness.writeFile('fixture-localServer.ts', original)

    const searchPattern =
      "// Update conversation updated_at timestamp\n      if (db) {\n        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)\n      }\n\n      console.log("
    const replacement =
      "// Update conversation updated_at timestamp\n      if (db) {\n        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)\n\n        // Update project timestamp if this conversation belongs to a project\n        const projectConversation = conversation as any\n        if (projectConversation?.project_id) {\n          db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectConversation.project_id)\n        }\n      }\n\n      console.log("

    const result = await editFile('fixture-localServer.ts', 'replace_first', {
      searchPattern,
      replacement,
      interpretEscapeSequences: true,
      validateContent: false,
      cwd: harness.workspaceDir,
    })

    const updated = await harness.readFile('fixture-localServer.ts')

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(updated).toContain('projectConversation?.project_id')
    expect(updated.endsWith(tailSnapshot)).toBe(true)
  })

  it('creates backup only when replace applies a change', async () => {
    const harness = await createToolFsHarness()
    const original = 'foo\nfoo\n'
    await harness.writeFile('replace-backup.txt', original)

    const result = await editFile('replace-backup.txt', 'replace', {
      searchPattern: 'foo',
      replacement: 'bar',
      createBackup: true,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(2)
    expect(result.backup).toBeDefined()
    expect(await harness.readFile('replace-backup.txt')).toBe('bar\nbar\n')

    const backups = await harness.listBackups('replace-backup.txt')
    expect(backups).toHaveLength(1)
    expect(await fs.readFile(backups[0], 'utf8')).toBe(original)
  })

  it('does not create backup when replace is a no-op', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('replace-noop-backup.txt', 'same\nsame\n')

    const result = await editFile('replace-noop-backup.txt', 'replace', {
      searchPattern: 'same',
      replacement: 'same',
      createBackup: true,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(0)
    expect(await harness.listBackups('replace-noop-backup.txt')).toHaveLength(0)
  })

  it('keeps $& literal in exact replace for Heimdall-style interface insertion', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile(
      'src/components/Heimdall/Heimdall.tsx',
      [
        'interface Bounds { minX: number maxX: number minY: number maxY: number }',
        '',
        'export const Heimdall = () => null',
        '',
      ].join('\n')
    )

    const searchPattern = 'interface Bounds { minX: number maxX: number minY: number maxY: number }'
    const replacement =
      "interface Bounds { minX: number maxX: number minY: number maxY: number } const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')"

    const result = await editFile('src/components/Heimdall/Heimdall.tsx', 'replace', {
      searchPattern,
      replacement,
      interpretEscapeSequences: false,
      cwd: harness.workspaceDir,
    })

    const updated = await harness.readFile('src/components/Heimdall/Heimdall.tsx')
    const interfaceCount = (updated.match(/interface Bounds/g) || []).length

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('exact')
    expect(result.replacements).toBe(1)
    expect(updated).toContain(replacement)
    expect(updated).not.toContain('\\interface Bounds')
    expect(interfaceCount).toBe(1)
  })
})

describe('editFile escape sequence behavior', () => {
  it('interprets escape sequences by default in search and replacement', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('escape-default.txt', 'alpha\nbeta\ngamma\n')

    const result = await editFile('escape-default.txt', 'replace_first', {
      searchPattern: 'beta\\ngamma',
      replacement: 'B\\nG',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(await harness.readFile('escape-default.txt')).toBe('alpha\nB\nG\n')
  })

  it('treats escape sequences literally when interpretEscapeSequences is false', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('escape-literal.txt', 'literal \\n marker\n')

    const result = await editFile('escape-literal.txt', 'replace_first', {
      searchPattern: '\\n',
      replacement: '[NL]',
      interpretEscapeSequences: false,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(await harness.readFile('escape-literal.txt')).toBe('literal [NL] marker\n')
  })
})

describe('editFile layered matching strategies', () => {
  it('uses line-ending normalized strategy for CRLF content and LF pattern', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('line-ending.txt', 'a\r\nb\r\nc\r\n')

    const result = await editFile('line-ending.txt', 'replace_first', {
      searchPattern: 'b\nc',
      replacement: 'B-C',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('line_ending_normalized')
    expect(await harness.readFile('line-ending.txt')).toBe('a\r\nB-C\r\n')
  })

  it('maps CRLF multiline spans correctly without partial replacement', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('line-ending-span.txt', 'top\r\nstart\r\nmiddle\r\nend\r\nbottom\r\n')

    const result = await editFile('line-ending-span.txt', 'replace_first', {
      searchPattern: 'start\nmiddle\nend',
      replacement: 'BLOCK',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('line_ending_normalized')
    expect(await harness.readFile('line-ending-span.txt')).toBe('top\r\nBLOCK\r\nbottom\r\n')
  })

  it('uses whitespace-normalized strategy for lines that differ by spaces and tabs', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('whitespace-normalized.txt', 'sum(\r\n  item   one,\r\n\titem\t two\r\n)\r\n')

    const result = await editFile('whitespace-normalized.txt', 'replace_first', {
      searchPattern: 'sum(\nitem one,\nitem two\n)',
      replacement: 'SUM()',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('whitespace_normalized')
    expect(await harness.readFile('whitespace-normalized.txt')).toBe('SUM()\r\n')
  })

  it('maps whitespace-normalized matches correctly in CRLF files', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('whitespace-crlf.txt', 'head\r\nitem   one\r\nitem\t two\r\ntail\r\n')

    const result = await editFile('whitespace-crlf.txt', 'replace_first', {
      searchPattern: 'item one\nitem two',
      replacement: 'items_done',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('whitespace_normalized')
    expect(await harness.readFile('whitespace-crlf.txt')).toBe('head\r\nitems_done\r\ntail\r\n')
  })

  it('uses single-span replacement for replace when strategy is whitespace_normalized', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile(
      'whitespace-replace-scope.txt',
      'head\r\nitem   one\r\nitem\t two\r\nmid\r\nitem   one\r\nitem\t two\r\ntail\r\n'
    )

    const result = await editFile('whitespace-replace-scope.txt', 'replace', {
      searchPattern: 'item one\nitem two',
      replacement: 'items_done',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(result.matchStrategy).toBe('whitespace_normalized')
    expect(await harness.readFile('whitespace-replace-scope.txt')).toBe(
      'head\r\nitems_done\r\nmid\r\nitem   one\r\nitem\t two\r\ntail\r\n'
    )
  })

  it('uses fuzzy strategy when exact/normalized strategies fail but similarity is high', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('fuzzy-success.txt', 'const status = "ready";\nconsole.log(status);\n')

    const result = await editFile('fuzzy-success.txt', 'replace_first', {
      searchPattern: 'const status = "raedy";\nconsole.log(status);',
      replacement: 'const status = "done";\nconsole.log(status);',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(result.matchStrategy).toBe('fuzzy')
    expect(await harness.readFile('fuzzy-success.txt')).toBe('const status = "done";\nconsole.log(status);\n')
  })

  it('uses single-span replacement for replace when strategy is fuzzy', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile(
      'fuzzy-replace-scope.txt',
      'const status = "ready";\nconsole.log(status);\n\nconst status = "running";\nconsole.log(status);\n'
    )

    const result = await editFile('fuzzy-replace-scope.txt', 'replace', {
      searchPattern: 'const status = "raedy";\nconsole.log(status);',
      replacement: 'const status = "done";\nconsole.log(status);',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(result.matchStrategy).toBe('fuzzy')
    expect(await harness.readFile('fuzzy-replace-scope.txt')).toBe(
      'const status = "done";\nconsole.log(status);\n\nconst status = "running";\nconsole.log(status);\n'
    )
  })

  it('fails when fuzzy matching is disabled and only fuzzy matching would succeed', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('fuzzy-disabled.txt', 'const status = "ready";\nconsole.log(status);\n')

    const result = await editFile('fuzzy-disabled.txt', 'replace_first', {
      searchPattern: 'const status = "raedy";\nconsole.log(status);',
      replacement: 'const status = "done";\nconsole.log(status);',
      enableFuzzyMatching: false,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.attemptedStrategies).toEqual(['exact', 'line_ending_normalized', 'whitespace_normalized'])
    expect(result.message).toContain('Search pattern not found in file')
  })

  it('reports attempted strategies when no match is found', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('no-match.txt', 'alpha\nbeta\n')

    const result = await editFile('no-match.txt', 'replace', {
      searchPattern: 'does not exist',
      replacement: 'value',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.attemptedStrategies).toContain('exact')
    expect(result.attemptedStrategies).toContain('fuzzy')
    expect(result.message).toContain('Attempted strategies:')
  })
})

describe('editFile indentation preservation', () => {
  it('preserves base indentation and relative tabs for non-exact matches when enabled', async () => {
    const harness = await createToolFsHarness()
    const original =
      'function main() {\n\tif (flag) {\n\t\tfirst();\n\t\t\tsecond();\n\t}\n}\n'
    const expected =
      'function main() {\n\tif (flag) {\n\trunA();\n\t\trunB();\n\t}\n}\n'
    await harness.writeFile('indent-preserve.txt', original)

    const result = await editFile('indent-preserve.txt', 'replace_first', {
      searchPattern: 'if (flag) {\nfirst();\n\tsecond();\n}',
      replacement: 'if (flag) {\nrunA();\n\trunB();\n}',
      preserveIndentation: true,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('whitespace_normalized')
    expect(await harness.readFile('indent-preserve.txt')).toBe(expected)
  })

  it('keeps replacement indentation unchanged when preserveIndentation is false', async () => {
    const harness = await createToolFsHarness()
    const original =
      'function main() {\n\tif (flag) {\n\t\tfirst();\n\t\t\tsecond();\n\t}\n}\n'
    const expected =
      'function main() {\nif (flag) {\nrunA();\n\trunB();\n}\n}\n'
    await harness.writeFile('indent-no-preserve.txt', original)

    const result = await editFile('indent-no-preserve.txt', 'replace_first', {
      searchPattern: 'if (flag) {\nfirst();\n\tsecond();\n}',
      replacement: 'if (flag) {\nrunA();\n\trunB();\n}',
      preserveIndentation: false,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('whitespace_normalized')
    expect(await harness.readFile('indent-no-preserve.txt')).toBe(expected)
  })
})

describe('editFile replace regressions on localServer-sized fixture', () => {
  const fixturePath = path.resolve(process.cwd(), 'electron/tools/__tests__/dummyfile.ts.test')

  it('keeps exact strategy global for repeated tokens in large fixture', async () => {
    const harness = await createToolFsHarness()
    const original = await fs.readFile(fixturePath, 'utf8')
    await harness.writeFile('fixture-exact-global.ts', original)

    const originalCount = (original.match(/run\(now, conversationId\)/g) || []).length
    expect(originalCount).toBeGreaterThan(1)

    const result = await editFile('fixture-exact-global.ts', 'replace', {
      searchPattern: 'run(now, conversationId)',
      replacement: 'run(now, updatedConversationId)',
      cwd: harness.workspaceDir,
    })

    const updated = await harness.readFile('fixture-exact-global.ts')
    const updatedCount = (updated.match(/run\(now, updatedConversationId\)/g) || []).length

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('exact')
    expect(result.replacements).toBe(originalCount)
    expect(updatedCount).toBe(originalCount)
    expect(updated).not.toContain('run(now, conversationId)')
  })

  it('uses single-span replacement for line-ending normalized matches in large fixture', async () => {
    const harness = await createToolFsHarness()
    const original = await fs.readFile(fixturePath, 'utf8')
    const crlfFixture = original.replace(/\n/g, '\r\n')
    const tailSnapshot = crlfFixture.slice(-12000)
    await harness.writeFile('fixture-line-ending-scope.ts', crlfFixture)

    const result = await editFile('fixture-line-ending-scope.ts', 'replace', {
      searchPattern:
        "// Update conversation updated_at timestamp\n      if (db) {\n        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)\n      }\n\n      console.log(",
      replacement: '/*line-ending-marker*/',
      cwd: harness.workspaceDir,
    })

    const updated = await harness.readFile('fixture-line-ending-scope.ts')

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('line_ending_normalized')
    expect(result.replacements).toBe(1)
    expect((updated.match(/\/\*line-ending-marker\*\//g) || []).length).toBe(1)
    expect(updated).toContain("db!.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)")
    expect(updated.endsWith(tailSnapshot)).toBe(true)
  })

  it('uses single-span replacement for whitespace-normalized matches in large fixture', async () => {
    const harness = await createToolFsHarness()
    const original = await fs.readFile(fixturePath, 'utf8')
    await harness.writeFile('fixture-whitespace-scope.ts', original)

    const result = await editFile('fixture-whitespace-scope.ts', 'replace', {
      searchPattern:
        "// Update conversation updated_at timestamp\nif (db) {\ndb.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)\n}\n\nconsole.log(",
      replacement: '/*whitespace-marker*/',
      cwd: harness.workspaceDir,
    })

    const updated = await harness.readFile('fixture-whitespace-scope.ts')

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('whitespace_normalized')
    expect(result.replacements).toBe(1)
    expect((updated.match(/\/\*whitespace-marker\*\//g) || []).length).toBe(1)
    expect(updated).toContain("db!.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)")
  })

  it('is a no-op for whitespace-normalized replace when replacement resolves to matched text', async () => {
    const harness = await createToolFsHarness()
    const original = await fs.readFile(fixturePath, 'utf8')
    await harness.writeFile('fixture-whitespace-noop.ts', original)

    const unindentedBlock =
      "// Update conversation updated_at timestamp\nif (db) {\n  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)\n}\n\nconsole.log("

    const result = await editFile('fixture-whitespace-noop.ts', 'replace', {
      searchPattern: unindentedBlock,
      replacement: unindentedBlock,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('whitespace_normalized')
    expect(result.replacements).toBe(0)
    expect(await harness.readFile('fixture-whitespace-noop.ts')).toBe(original)
  })

  it('uses single-span replacement for fuzzy matches in large fixture', async () => {
    const harness = await createToolFsHarness()
    const original = await fs.readFile(fixturePath, 'utf8')
    await harness.writeFile('fixture-fuzzy-scope.ts', original)

    const result = await editFile('fixture-fuzzy-scope.ts', 'replace', {
      searchPattern:
        "console.log(\n        '[LocalServer] ✅ Bulk insreted',\n        createdMessages.length,\n        'messages into conversation:',\n        conversationId\n      )",
      replacement:
        "console.log(\n        '[LocalServer] ✅ Bulk inserted [patched]',\n        createdMessages.length,\n        'messages into conversation:',\n        conversationId\n      )",
      cwd: harness.workspaceDir,
    })

    const updated = await harness.readFile('fixture-fuzzy-scope.ts')

    expect(result.success).toBe(true)
    expect(result.matchStrategy).toBe('fuzzy')
    expect(result.replacements).toBe(1)
    expect((updated.match(/Bulk inserted \[patched\]/g) || []).length).toBe(1)
    expect(updated).toContain('[LocalServer] ✅ Bulk inserted')
  })
})

describe('editFile append behavior', () => {
  it('appends content to an existing file in order', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('append-existing.txt', 'alpha')

    const result = await editFile('append-existing.txt', 'append', {
      content: '\nbeta',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(await harness.readFile('append-existing.txt')).toBe('alpha\nbeta')
  })

  it('creates a file when appending to a non-existent path', async () => {
    const harness = await createToolFsHarness()

    const result = await editFile('append-new.txt', 'append', {
      content: 'hello',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(await harness.fileExists('append-new.txt')).toBe(true)
    expect(await harness.readFile('append-new.txt')).toBe('hello')
  })

  it('creates a backup with original content when appending with createBackup', async () => {
    const harness = await createToolFsHarness()
    const original = 'before'
    await harness.writeFile('append-backup.txt', original)

    const result = await editFile('append-backup.txt', 'append', {
      content: ' after',
      createBackup: true,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.backup).toBeDefined()
    expect(await harness.readFile('append-backup.txt')).toBe('before after')

    const backups = await harness.listBackups('append-backup.txt')
    expect(backups).toHaveLength(1)
    expect(await fs.readFile(backups[0], 'utf8')).toBe(original)
  })

  it('accepts empty-string append content and leaves file content unchanged', async () => {
    const harness = await createToolFsHarness()
    const original = 'unchanged'
    await harness.writeFile('append-empty.txt', original)

    const result = await editFile('append-empty.txt', 'append', {
      content: '',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.replacements).toBe(1)
    expect(await harness.readFile('append-empty.txt')).toBe(original)
  })
})

describe('editFile read/edit validation coordination', () => {
  it('succeeds when expected hash and metadata match current file state', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('validation-pass.txt', 'version=1\n')

    const readResult = await readTextFile('validation-pass.txt', { cwd: harness.workspaceDir })

    const result = await editFile('validation-pass.txt', 'replace', {
      searchPattern: '1',
      replacement: '2',
      validateContent: true,
      expectedHash: readResult.contentHash,
      expectedMetadata: readResult.metadata,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.validation?.valid).toBe(true)
    expect(await harness.readFile('validation-pass.txt')).toBe('version=2\n')
  })

  it('fails with stale expected hash after external mutation', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('validation-hash-fail.txt', 'alpha=old\n')
    const absolutePath = harness.absolutePath('validation-hash-fail.txt')
    const readResult = await readTextFile('validation-hash-fail.txt', { cwd: harness.workspaceDir })

    await fs.writeFile(absolutePath, 'alpha=changed\n', 'utf8')

    const result = await editFile('validation-hash-fail.txt', 'replace', {
      searchPattern: 'changed',
      replacement: 'updated',
      validateContent: true,
      expectedHash: readResult.contentHash,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Validation failed')
    expect(result.validation?.reason).toContain('Content hash mismatch')
    expect(await harness.readFile('validation-hash-fail.txt')).toBe('alpha=changed\n')
  })

  it('bypasses stale hash when validateContent is false', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('validation-bypass.txt', 'alpha=old\n')
    const absolutePath = harness.absolutePath('validation-bypass.txt')
    const readResult = await readTextFile('validation-bypass.txt', { cwd: harness.workspaceDir })

    await fs.writeFile(absolutePath, 'alpha=changed\n', 'utf8')

    const result = await editFile('validation-bypass.txt', 'replace', {
      searchPattern: 'changed',
      replacement: 'updated',
      expectedHash: readResult.contentHash,
      validateContent: false,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.validation).toBeUndefined()
    expect(await harness.readFile('validation-bypass.txt')).toBe('alpha=updated\n')
  })

  it('fails metadata validation when mtime is newer than expected', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('validation-metadata-fail.txt', 'meta=true\n')
    const absolutePath = harness.absolutePath('validation-metadata-fail.txt')
    const readResult = await readTextFile('validation-metadata-fail.txt', { cwd: harness.workspaceDir })
    const newerTime = new Date(readResult.metadata.lastModified.getTime() + 5000)

    await fs.utimes(absolutePath, newerTime, newerTime)

    const result = await editFile('validation-metadata-fail.txt', 'replace', {
      searchPattern: 'meta=true',
      replacement: 'meta=false',
      validateContent: true,
      expectedMetadata: readResult.metadata,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Validation failed')
    expect(result.validation?.reason).toContain('modified since it was read')
    expect(await harness.readFile('validation-metadata-fail.txt')).toBe('meta=true\n')
  })

  it('passes metadata validation when mtime has not advanced', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('validation-metadata-pass.txt', 'flag=0\n')
    const readResult = await readTextFile('validation-metadata-pass.txt', { cwd: harness.workspaceDir })

    const result = await editFile('validation-metadata-pass.txt', 'replace', {
      searchPattern: '0',
      replacement: '1',
      validateContent: true,
      expectedMetadata: readResult.metadata,
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(result.validation?.valid).toBe(true)
    expect(await harness.readFile('validation-metadata-pass.txt')).toBe('flag=1\n')
  })
})

describe('editFile workspace restrictions (POSIX)', () => {
  it('allows relative paths inside the configured cwd', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('nested/in-scope.txt', '')

    const result = await editFile('nested/in-scope.txt', 'append', {
      content: 'ok',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(true)
    expect(await harness.readFile('nested/in-scope.txt')).toBe('ok')
  })

  it('blocks replace for paths outside configured cwd', async () => {
    const harness = await createToolFsHarness()

    const result = await editFile('../outside-replace.txt', 'replace', {
      searchPattern: 'x',
      replacement: 'y',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Access denied')
  })

  it('blocks append for paths outside configured cwd', async () => {
    const harness = await createToolFsHarness()

    const result = await editFile('../outside-append.txt', 'append', {
      content: 'x',
      cwd: harness.workspaceDir,
    })

    expect(result.success).toBe(false)
    expect(result.message).toContain('Access denied')
  })
})
