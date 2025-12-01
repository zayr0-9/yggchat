import { spawn } from 'child_process'
import path from 'path'
import { getWSLCommandArgs, isWindows, toWslPath } from '../utils/wslBridge.js'

const DEFAULT_MAX_OUTPUT_CHARS = 20000

export interface BashOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
  maxOutputChars?: number
}

export interface BashResult {
  success: boolean
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  durationMs: number
  timedOut: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
  maxOutputChars: number
  error?: string
}

function resolveCwd(inputCwd?: string): string {
  const cwdCandidate = (inputCwd?.trim() || process.cwd()).trim()
  if (!cwdCandidate) return process.cwd()

  if (isWindows()) {
    const normalized = path.win32.isAbsolute(cwdCandidate)
      ? path.win32.normalize(cwdCandidate)
      : path.win32.resolve(cwdCandidate)
    return toWslPath(normalized)
  }

  return path.isAbsolute(cwdCandidate) ? cwdCandidate : path.resolve(cwdCandidate)
}

async function buildCommand(command: string, cwd?: string): Promise<{ cmd: string; args: string[]; wslCwd?: string }> {
  const args = ['-lc', command]
  if (!isWindows()) {
    return { cmd: 'bash', args, wslCwd: cwd }
  }

  const normalizedCwd = cwd ? toWslPath(cwd) : undefined
  const [cmd, wslArgs] = await getWSLCommandArgs('bash', args, normalizedCwd)
  return { cmd, args: wslArgs, wslCwd: normalizedCwd }
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
  const startTime = Date.now()
  const maxOutputChars = clampMaxOutput(options.maxOutputChars)
  const resolvedCwd = resolveCwd(options.cwd)

  const { cmd, args, wslCwd } = await buildCommand(command, resolvedCwd)

  const spawnOptions: { cwd?: string; env: NodeJS.ProcessEnv } = {
    env: { ...process.env, ...(options.env || {}) },
  }

  if (!isWindows()) {
    spawnOptions.cwd = resolvedCwd
  }

  let stdout = ''
  let stderr = ''
  let stdoutTruncated = false
  let stderrTruncated = false
  let remaining = maxOutputChars
  let timedOut = false
  let timeoutHandle: NodeJS.Timeout | null = null

  const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
    if (remaining <= 0) {
      if (target === 'stdout') stdoutTruncated = true
      else stderrTruncated = true
      return
    }

    const text = chunk.toString('utf8')
    const toTake = Math.min(remaining, text.length)
    if (target === 'stdout') {
      stdout += text.slice(0, toTake)
      if (toTake < text.length) stdoutTruncated = true
    } else {
      stderr += text.slice(0, toTake)
      if (toTake < text.length) stderrTruncated = true
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
      const durationMs = Date.now() - startTime
      finalize({
        success: false,
        command: `${cmd} ${args.join(' ')}`,
        cwd: wslCwd ?? resolvedCwd,
        stdout,
        stderr,
        exitCode: null,
        signal: null,
        durationMs,
        timedOut,
        stdoutTruncated,
        stderrTruncated,
        maxOutputChars,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    child.on('close', (code, signal) => {
      const durationMs = Date.now() - startTime
      finalize({
        success: !timedOut && code === 0,
        command: `${cmd} ${args.join(' ')}`,
        cwd: wslCwd ?? resolvedCwd,
        stdout,
        stderr,
        exitCode: code,
        signal,
        durationMs,
        timedOut,
        stdoutTruncated,
        stderrTruncated,
        maxOutputChars,
      })
    })
  })
}
