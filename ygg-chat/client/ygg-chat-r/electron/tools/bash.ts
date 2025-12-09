import { spawn } from 'child_process'
import path from 'path'
import { getWSLCommandArgs, isWindows, toWslPath } from '../utils/wslBridge.js'

const DEFAULT_MAX_OUTPUT_CHARS = 20000

// Commands that return exit code 1 for "no matches" (not an error)
const EXIT_1_NO_MATCH_COMMANDS = ['grep', 'egrep', 'fgrep', 'diff', 'cmp', 'awk']

function getDefaultSuccessCodes(command: string): number[] {
  const trimmed = command.trim()
  const firstWord = trimmed.split(/\s+/)[0]
  // Handle paths like /usr/bin/grep
  const basename = firstWord.split('/').pop() || firstWord

  if (EXIT_1_NO_MATCH_COMMANDS.includes(basename)) {
    return [0, 1]
  }
  return [0]
}

export interface BashOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
  maxOutputChars?: number
  /** Treat these exit codes as success instead of failure */
  successCodes?: number[]
}


export interface BashResult {
  success: boolean
  command: string
  cwd: string
  stdout: string
  stderr: string
  error?: string
}

type CwdResolution = {
  display: string // what we return to the caller (windows stays windows)
  forSpawn?: string // what we pass to WSL/bash (converted when on windows)
  type: 'windows' | 'posix'
}

function resolveCwd(inputCwd?: string): CwdResolution {
  const cwdCandidate = (inputCwd?.trim() || process.cwd()).trim()
  if (!cwdCandidate) {
    const fallback = process.cwd()
    return { display: fallback, forSpawn: fallback, type: isWindows() ? 'windows' : 'posix' }
  }

  if (isWindows()) {
    const normalizedWin = path.win32.isAbsolute(cwdCandidate)
      ? path.win32.normalize(cwdCandidate)
      : path.win32.resolve(cwdCandidate)
    return { display: normalizedWin, forSpawn: toWslPath(normalizedWin), type: 'windows' }
  }

  const posix = path.isAbsolute(cwdCandidate) ? cwdCandidate : path.resolve(cwdCandidate)
  return { display: posix, forSpawn: posix, type: 'posix' }
}

async function buildCommand(
  command: string,
  spawnCwd?: string,
  type: 'windows' | 'posix' = 'posix'
): Promise<{ cmd: string; args: string[]; wslCwd?: string }> {
  const args = ['-lc', command]
  if (type === 'posix') {
    return { cmd: 'bash', args, wslCwd: spawnCwd }
  }

  const [cmd, wslArgs] = await getWSLCommandArgs('bash', args, spawnCwd)
  return { cmd, args: wslArgs, wslCwd: spawnCwd }
}

function clampMaxOutput(max?: number): number {
  if (max === undefined || max === null) {
    return DEFAULT_MAX_OUTPUT_CHARS
  }
  if (Number.isNaN(max) || max <= 0) {
    return DEFAULT_MAX_OUTPUT_CHARS
  }
  return Math.min(200000, Math.floor(max))
}

export async function runBashCommand(command: string, options: BashOptions = {}): Promise<BashResult> {
  // const startTime = Date.now()
  const maxOutputChars = clampMaxOutput(options.maxOutputChars)
  const { display: displayCwd, forSpawn: spawnCwd, type: cwdType } = resolveCwd(options.cwd)

  const { cmd, args, wslCwd } = await buildCommand(command, spawnCwd, cwdType)

  const spawnOptions: { cwd?: string; env: NodeJS.ProcessEnv } = {
    env: {
      ...process.env,
      COLUMNS: '120',
      LINES: '24',
      ...(options.env || {}),
    },
  }

  if (cwdType === 'posix') {
    spawnOptions.cwd = spawnCwd
  }

  let stdout = ''
  let stderr = ''
  let remaining = maxOutputChars
  let timeoutHandle: NodeJS.Timeout | null = null
  let timedOut = false

  const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
    if (remaining <= 0) {
      return
    }

    const text = chunk.toString('utf8')
    const toTake = Math.min(remaining, text.length)
    if (target === 'stdout') {
      stdout += text.slice(0, toTake)
    } else {
      stderr += text.slice(0, toTake)
    }

    remaining -= toTake
  }

  return new Promise<BashResult>(resolve => {
    const child = spawn(cmd, args, {
      cwd: spawnOptions.cwd,
      env: spawnOptions.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (options.input) {
      child.stdin.end(options.input)
    } else {
      child.stdin.end()
    }

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 300)
      }, options.timeoutMs)
    }

    child.stdout.on('data', chunk => append('stdout', chunk))
    child.stderr.on('data', chunk => append('stderr', chunk))

    const finalize = (result: BashResult) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
      resolve(result)
    }

    child.on('error', error => {
      finalize({
        success: false,
        command: `${cmd} ${args.join(' ')}`,
        cwd: wslCwd ?? displayCwd,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    child.on('close', (code) => {
      const successCodes = new Set(options.successCodes ?? getDefaultSuccessCodes(command))
      finalize({
        success: !timedOut && code !== null && successCodes.has(code),
        command: `${cmd} ${args.join(' ')}`,
        cwd: wslCwd ?? displayCwd,
        stdout,
        stderr,
      })
    })
  })
}
