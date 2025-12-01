import { spawn } from 'child_process'
import path from 'path'
import { isWindows, getWSLCommandArgs } from '../../wslBridge'

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

function windowsPathToWsl(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) return trimmed
  // Already looks like a Linux path
  if (trimmed.startsWith('/')) {
    return trimmed
  }

  const driveMatch = trimmed.match(/^([a-zA-Z]):[\\/](.*)$/)
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase()
    const rest = driveMatch[2].replace(/\\+/g, '/').replace(/\/+/g, '/')
    return `/mnt/${drive}/${rest}`
  }

  return trimmed.replace(/\\+/g, '/').replace(/\/+/g, '/')
}

async function buildCommand(
  command: string,
  cwd: string | undefined
): Promise<{ cmd: string; args: string[]; wslCwd: string | undefined }> {
  const baseArgs = ['-lc', command]
  if (!isWindows()) {
    return { cmd: 'bash', args: baseArgs, wslCwd: cwd }
  }

  const normalizedCwd = cwd ? windowsPathToWsl(cwd) : undefined
  const [cmd, args] = await getWSLCommandArgs('bash', baseArgs, normalizedCwd)
  return { cmd, args, wslCwd: normalizedCwd }
}

function resolveCwd(inputCwd?: string): string {
  const cwdCandidate = inputCwd?.trim() || process.cwd()
  if (!cwdCandidate) {
    return process.cwd()
  }

  if (isWindows()) {
    const winPath = path.win32.isAbsolute(cwdCandidate)
      ? path.win32.normalize(cwdCandidate)
      : path.win32.resolve(cwdCandidate)
    return windowsPathToWsl(winPath)
  }

  return path.isAbsolute(cwdCandidate) ? cwdCandidate : path.resolve(cwdCandidate)
}

export async function runBashCommand(
  command: string,
  options: BashOptions = {}
): Promise<BashResult> {
  const startTime = Date.now()
  const maxOutputChars = options.maxOutputChars && options.maxOutputChars > 0 ? options.maxOutputChars : DEFAULT_MAX_OUTPUT_CHARS
  const resolvedCwd = resolveCwd(options.cwd)

  const { cmd, args, wslCwd } = await buildCommand(command, resolvedCwd)

  const spawnOptions: { cwd?: string; env: NodeJS.ProcessEnv } = {
    env: { ...process.env, ...options.env },
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

    const chunkStr = chunk.toString('utf8')
    const toTake = Math.min(remaining, chunkStr.length)
    if (target === 'stdout') {
      stdout += chunkStr.slice(0, toTake)
      if (toTake < chunkStr.length) stdoutTruncated = true
    } else {
      stderr += chunkStr.slice(0, toTake)
      if (toTake < chunkStr.length) stderrTruncated = true
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
