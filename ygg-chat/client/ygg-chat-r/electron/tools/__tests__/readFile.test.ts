import * as path from 'path'
import { promises as fs } from 'fs'
import { describe, expect, it } from 'vitest'
import { readTextFile, readFileContinuation } from '../readFile.js'
import { createToolFsHarness } from './helpers/toolFsHarness.js'

describe('readTextFile workspace enforcement', () => {
  it('blocks traversal outside workspace for relative paths', async () => {
    const harness = await createToolFsHarness()

    const outsidePath = path.resolve(harness.workspaceDir, '..', 'outside-read.txt')
    await fs.writeFile(outsidePath, 'outside', 'utf8')

    await expect(
      readTextFile('../outside-read.txt', {
        cwd: harness.workspaceDir,
      })
    ).rejects.toThrow(/outside the workspace/)
  })

  it('allows reading files inside workspace', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('inside.txt', 'hello\\nworld\\n')

    const result = await readTextFile('inside.txt', { cwd: harness.workspaceDir })
    expect(result.content).toBe('hello\\nworld\\n')
    expect(result.truncated).toBe(false)
  })
})

describe('readTextFile option behavior', () => {
  it('defaults to includeHash=false when omitted', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('hash-default-off.txt', 'a\nb\n')

    const result = await readTextFile('hash-default-off.txt', {
      cwd: harness.workspaceDir,
    })

    expect(result.contentHash).toBeUndefined()
    expect(result.fileHash).toBeUndefined()
  })

  it('respects includeHash=false', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('hashless.txt', 'a\nb\n')

    const result = await readTextFile('hashless.txt', {
      cwd: harness.workspaceDir,
      includeHash: false,
    })

    expect(result.contentHash).toBeUndefined()
    expect(result.fileHash).toBeUndefined()
  })

  it('returns content hash without full-file hash for bounded line reads', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('bounded-lines.txt', Array.from({ length: 200 }, (_, i) => `line-${i + 1}`).join('\n'))

    const result = await readTextFile('bounded-lines.txt', {
      cwd: harness.workspaceDir,
      startLine: 5,
      endLine: 8,
      includeHash: true,
    })

    expect(result.content).toBe('line-5\nline-6\nline-7\nline-8')
    expect(result.contentHash).toBeTruthy()
    expect(result.fileHash).toBeUndefined()
    expect(result.totalLines).toBeUndefined()
  })

  it('validates line numbers before reading', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('lines.txt', 'one\ntwo\nthree\n')

    await expect(
      readTextFile('lines.txt', {
        cwd: harness.workspaceDir,
        startLine: 0,
      })
    ).rejects.toThrow(/startLine must be an integer >= 1/)

    await expect(
      readTextFile('lines.txt', {
        cwd: harness.workspaceDir,
        endLine: 1.5,
      })
    ).rejects.toThrow(/endLine must be an integer >= 1/)

    await expect(
      readTextFile('lines.txt', {
        cwd: harness.workspaceDir,
        ranges: [{ startLine: 1, endLine: 0 }],
      })
    ).rejects.toThrow(/ranges\[0\]\.endLine must be an integer >= 1/)
  })

  it('continuation reads expected next chunk', async () => {
    const harness = await createToolFsHarness()
    await harness.writeFile('continuation.txt', '1\n2\n3\n4\n5\n')

    const result = await readFileContinuation('continuation.txt', 2, 2, {
      cwd: harness.workspaceDir,
      includeHash: false,
    })

    expect(result.content).toBe('3\n4')
    expect(result.startLine).toBe(3)
    expect(result.endLine).toBe(4)
  })
})
