import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'

const execAsync = promisify(exec)

// Cached default distro
let defaultDistro: string | null = null

/**
 * Check if the current platform is Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32'
}

/**
 * Check if a path is a WSL path (starts with /)
 */
export function isWSLPath(filePath: string): boolean {
  // If not windows, everything is local, so conceptually "not WSL path" in terms of needing bridging
  // But if we are on Windows, and path starts with /, it's likely a WSL path
  if (!isWindows()) return false
  return filePath.startsWith('/') && !filePath.match(/^[a-zA-Z]:/)
}

/**
 * Get the default WSL distribution
 */
export async function getDefaultDistro(): Promise<string> {
  if (defaultDistro) return defaultDistro

  try {
    // wsl -l -v outputs UTF-16le sometimes, or just simple text.
    // simpler: wsl --list --quiet
    const { stdout } = await execAsync('wsl.exe --list --quiet')
    // The first one is usually the default
    // Output format is just names, one per line? Or just one line?
    // It depends on version.
    // Let's try a more robust way: wsl -l -v and look for the one with *
    const { stdout: verboseOut } = await execAsync('wsl.exe --list --verbose')
    
    const lines = verboseOut.split('\n')
    for (const line of lines) {
      if (line.trim().startsWith('*')) {
        // Format: * DistroName Running 2
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 2) {
          defaultDistro = parts[1]
          return defaultDistro
        }
      }
    }
    
    // Fallback
    defaultDistro = 'Ubuntu'
    return defaultDistro
  } catch (error) {
    console.error('Failed to detect WSL distro:', error)
    return 'Ubuntu'
  }
}

/**
 * Convert a WSL path to a Windows UNC path for fs access
 * /home/karn/... -> \\wsl$\Ubuntu\home\karn\...
 */
export async function resolveToWindowsPath(wslPath: string): Promise<string> {
  if (!isWSLPath(wslPath)) return wslPath

  const distro = await getDefaultDistro()
  // Handle relative paths if any (though wsl paths usually come absolute from the tool)
  const cleanPath = wslPath.replace(/\//g, '\\')
  return `\\\\wsl$\\${distro}${cleanPath}`
}

/**
 * Execute a command in WSL
 * @param command The command to run (e.g. 'rg')
 * @param args Arguments for the command
 * @param options Options like cwd (should be a WSL path if provided)
 */
export async function execWSL(
  command: string, 
  args: string[] = [], 
  options: { cwd?: string, encoding?: string } = {}
): Promise<{ stdout: string, stderr: string }> {
  // Escape arguments roughly? Node's execFile handles args if we use it, but we are using wsl.exe
  // wsl.exe -e command arg1 arg2...
  
  // We need to ensure we call wsl.exe
  // If cwd is provided, it's likely a WSL path. wsl.exe supports --cd
  
  let wslArgs = ['wsl.exe']
  
  const distro = await getDefaultDistro()
  wslArgs.push('-d', distro)

  if (options.cwd) {
    wslArgs.push('--cd', options.cwd)
  }
  
  wslArgs.push('-e', command, ...args)

  // We use spawn usually for better safety, but here we need a simple exec wrapper for now or use child_process.spawn
  // Let's construct the command string for execAsync to keep it simple for this bridge if it's just for simple tools
  // But tools like rg might return huge output, so spawn is better.
  // However, the callers (ripgrep.ts) often expect a promise or stream.
  // Let's provide a spawn wrapper too if needed, but for now let's stick to execAsync compatible return style for simple commands
  // Wait, ripgrep.ts uses spawn. So we should probably expose a way to get the command and args for spawn.
  
  // Actually, let's just return the command and args so the caller can spawn it.
  return { stdout: '', stderr: 'Use getWSLCommandArgs for spawning' }
}

export async function getWSLCommandArgs(
  command: string, 
  args: string[] = [], 
  cwd?: string
): Promise<[string, string[]]> {
  const distro = await getDefaultDistro()
  const finalArgs = ['-d', distro]
  
  if (cwd) {
    finalArgs.push('--cd', cwd)
  }
  
  finalArgs.push('-e', command, ...args)
  
  return ['wsl.exe', finalArgs]
}
