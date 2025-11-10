// ygg-chat/server/src/utils/tools/core/ripgrep.ts
import { spawn } from 'child_process'
import * as path from 'path'

export interface RipgrepOptions {
  caseSensitive?: boolean // -s (case-sensitive) vs -i (case-insensitive)
  lineNumbers?: boolean // -n (show line numbers)
  count?: boolean // -c (count matches)
  filesWithMatches?: boolean // -l (list files with matches)
  maxCount?: number // -m (max matches per file)
  glob?: string // -g (file pattern)
  hidden?: boolean // --hidden (search hidden files)
  noIgnore?: boolean // --no-ignore (ignore .gitignore)
  contextLines?: number // -C (context lines before and after)
}

export interface RipgrepResult {
  success: boolean
  matches: Array<{
    file: string
    lineNumber?: number
    line?: string
    matchCount?: number
  }>
  error?: string
  command?: string
  durationMs?: number
}

export async function ripgrepSearch(
  pattern: string,
  searchPath: string = '.',
  options: RipgrepOptions = {}
): Promise<RipgrepResult> {
  const startTime = Date.now()
  const {
    caseSensitive = false,
    lineNumbers = true,
    count = false,
    filesWithMatches = false,
    maxCount,
    glob,
    hidden = false,
    noIgnore = false,
    contextLines,
  } = options

  // Build rg command arguments
  const args: string[] = []

  // Pattern (must be first non-option argument)
  args.push(pattern)

  // Path to search
  const resolvedPath = path.resolve(searchPath)
  args.push(resolvedPath)

  // Options
  if (!caseSensitive) {
    args.push('-i') // Case-insensitive
  } else {
    args.push('-s') // Case-sensitive
  }

  if (lineNumbers && !count && !filesWithMatches) {
    args.push('-n') // Show line numbers
  }

  if (count) {
    args.push('-c') // Count matches
  }

  if (filesWithMatches) {
    args.push('-l') // List files with matches
  }

  if (maxCount !== undefined) {
    args.push('-m', maxCount.toString())
  }

  if (glob) {
    args.push('-g', glob)
  }

  if (hidden) {
    args.push('--hidden')
  }

  if (noIgnore) {
    args.push('--no-ignore')
  }

  if (contextLines !== undefined) {
    args.push('-C', contextLines.toString())
  }

  // Add JSON output format for easier parsing (if supported and not using simple modes)
  if (!count && !filesWithMatches) {
    args.push('--json')
  }

  return new Promise((resolve) => {
    const command = `rg ${args.join(' ')}`
    const child = spawn('rg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8')
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString('utf8')
    })

    child.on('error', (error) => {
      resolve({
        success: false,
        matches: [],
        error: `Failed to execute ripgrep: ${error.message}. Make sure ripgrep (rg) is installed and in your PATH.`,
        command,
        durationMs: Date.now() - startTime,
      })
    })

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime

      // rg returns 0 when matches found, 1 when no matches, 2 for error
      if (code === 2 && stderr) {
        resolve({
          success: false,
          matches: [],
          error: `ripgrep error: ${stderr.trim()}`,
          command,
          durationMs,
        })
        return
      }

      try {
        const matches = parseRipgrepOutput(stdout, pattern, {
          count,
          filesWithMatches,
        })

        resolve({
          success: true,
          matches,
          command,
          durationMs,
        })
      } catch (parseError: any) {
        resolve({
          success: false,
          matches: [],
          error: `Failed to parse ripgrep output: ${parseError.message}`,
          command,
          durationMs,
        })
      }
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 1000)
    }, 30000)
  })
}

function parseRipgrepOutput(
  output: string,
  pattern: string,
  flags: { count?: boolean; filesWithMatches?: boolean }
): Array<{
  file: string
  lineNumber?: number
  line?: string
  matchCount?: number
}> {
  const matches: Array<{
    file: string
    lineNumber?: number
    line?: string
    matchCount?: number
  }> = []

  if (!output.trim()) {
    return matches
  }

  // Handle --count mode (-c)
  if (flags.count) {
    const lines = output.trim().split('\n')
    for (const line of lines) {
      const parts = line.trim().split(':')
      if (parts.length >= 2) {
        matches.push({
          file: parts[0],
          matchCount: parseInt(parts[1]) || 0,
        })
      }
    }
    return matches
  }

  // Handle --files-with-matches mode (-l)
  if (flags.filesWithMatches) {
    const lines = output.trim().split('\n')
    for (const line of lines) {
      if (line.trim()) {
        matches.push({ file: line.trim() })
      }
    }
    return matches
  }

  // Handle JSON mode (default)
  try {
    const lines = output.trim().split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const data = JSON.parse(line)
        if (data.type === 'match' && data.data) {
          const { path: filePath, lines: matchLines, line_number } = data.data
          const file = typeof filePath === 'string' ? filePath : filePath?.text || ''
          
          if (matchLines && matchLines.text) {
            matches.push({
              file,
              lineNumber: line_number,
              line: matchLines.text,
            })
          }
        }
      } catch (e) {
        // Skip invalid JSON lines
        continue
      }
    }
  } catch (error) {
    // Fallback to simple line parsing if JSON parsing fails
    const lines = output.trim().split('\n')
    for (const line of lines) {
      const match = line.match(/^(.+?):(\d+):(.*)$/)
      if (match) {
        matches.push({
          file: match[1],
          lineNumber: parseInt(match[2]),
          line: match[3],
        })
      }
    }
  }

  return matches
}

export default ripgrepSearch
