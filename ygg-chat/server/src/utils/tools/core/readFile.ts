// ygg-chat/server/src/utils/tools/core/readFile.ts
import * as fs from 'fs'
import * as path from 'path'

export interface ReadFileOptions {
  maxBytes?: number // safety limit to avoid huge reads; default ~200KB
}

function isLikelyBinary(buf: Buffer): boolean {
  // Heuristic: if buffer contains many null bytes or non-text control chars
  // within the first chunk, treat as binary
  const len = Math.min(buf.length, 4096)
  let suspicious = 0
  for (let i = 0; i < len; i++) {
    const byte = buf[i]
    if (byte === 0) return true
    // allow common control chars: tab(9), lf(10), cr(13)
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious++
  }
  return suspicious / len > 0.3
}

export async function readTextFile(
  inputPath: string,
  options: ReadFileOptions = {}
): Promise<{
  content: string
  truncated: boolean
  sizeBytes: number
  absolutePath: string
}> {
  const maxBytes = options.maxBytes && options.maxBytes > 0 ? options.maxBytes : 200 * 1024

  // Resolve absolute path
  const abs = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath)

  // Check existence and get size
  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(abs)
  } catch (e) {
    throw new Error(`File '${inputPath}' does not exist or is not accessible`)
  }
  if (!stats.isFile()) {
    throw new Error(`'${inputPath}' is not a file`)
  }

  const sizeBytes = stats.size
  const toRead = Math.min(sizeBytes, maxBytes)

  // Read only up to maxBytes
  let buf: Buffer
  if (toRead === sizeBytes) {
    buf = await fs.promises.readFile(abs)
  } else {
    const fd = await fs.promises.open(abs, 'r')
    try {
      buf = Buffer.allocUnsafe(toRead)
      await fd.read(buf, 0, toRead, 0)
    } finally {
      await fd.close()
    }
  }

  // Detect binary
  if (isLikelyBinary(buf)) {
    throw new Error('Binary file detected; reading binary is not supported by this tool')
  }

  const content = buf.toString('utf8')
  const truncated = sizeBytes > maxBytes

  return { content, truncated, sizeBytes, absolutePath: abs }
}
