// electron/skills/skillInstaller.ts
// Install skills from GitHub, ClawdHub, or local folders

import AdmZip from 'adm-zip'
import fs from 'fs/promises'
import path from 'path'
import yaml from 'yaml'
import { skillRegistry } from './skillLoader.js'

interface GitHubContent {
  name: string
  path: string
  type: 'file' | 'dir'
  download_url: string | null
  url: string // API URL for directories
}

interface InstallResult {
  success: boolean
  skillName?: string
  error?: string
}

interface CatalogSkill {
  name: string
  description: string
  path: string // Path within repo (e.g., "skills/code-review")
}

const GITHUB_API_BASE = 'https://api.github.com'
const USER_AGENT = 'ygg-chat-electron'

/**
 * Fetch JSON from GitHub API
 */
async function fetchGitHubAPI(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.github.v3+json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Repository or path not found')
    }
    if (response.status === 403) {
      throw new Error('GitHub API rate limit exceeded. Try again later.')
    }
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Download a file from URL
 */
async function downloadFile(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`)
  }

  return response.text()
}

/**
 * Recursively download directory contents from GitHub
 */
async function downloadDirectory(contents: GitHubContent[], targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true })

  for (const item of contents) {
    const targetPath = path.join(targetDir, item.name)

    if (item.type === 'file' && item.download_url) {
      const content = await downloadFile(item.download_url)
      await fs.writeFile(targetPath, content, 'utf-8')
    } else if (item.type === 'dir') {
      // Fetch subdirectory contents
      const subContents = await fetchGitHubAPI(item.url)
      await downloadDirectory(subContents, targetPath)
    }
  }
}

/**
 * Parse GitHub source string
 * Formats:
 *   - "owner/repo" -> entire repo
 *   - "owner/repo/path/to/skill" -> specific path
 *   - "https://github.com/owner/repo" -> entire repo
 *   - "https://github.com/owner/repo/tree/main/path" -> specific path
 */
function parseGitHubSource(source: string): { owner: string; repo: string; path: string } {
  // Handle full URLs
  if (source.startsWith('https://github.com/')) {
    const url = new URL(source)
    const parts = url.pathname.split('/').filter(Boolean)

    const owner = parts[0]
    const repo = parts[1]

    // Check for /tree/branch/path format
    if (parts[2] === 'tree' && parts.length > 3) {
      // Skip branch name (parts[3]), get rest as path
      const pathParts = parts.slice(4)
      return { owner, repo, path: pathParts.join('/') }
    }

    return { owner, repo, path: '' }
  }

  // Handle shorthand format: owner/repo or owner/repo/path
  const parts = source.split('/')
  if (parts.length < 2) {
    throw new Error('Invalid source format. Use "owner/repo" or "owner/repo/path"')
  }

  const [owner, repo, ...pathParts] = parts
  return { owner, repo, path: pathParts.join('/') }
}

/**
 * Validate that a directory contains a valid SKILL.md
 */
async function validateSkillDirectory(dirPath: string): Promise<{ valid: boolean; name?: string; error?: string }> {
  const skillMdPath = path.join(dirPath, 'SKILL.md')

  try {
    const content = await fs.readFile(skillMdPath, 'utf-8')

    // Check for frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---/)
    if (!match) {
      return { valid: false, error: 'SKILL.md missing YAML frontmatter' }
    }

    // Parse frontmatter to get name
    const frontmatter = yaml.parse(match[1])

    if (!frontmatter.name) {
      return { valid: false, error: 'SKILL.md missing required "name" field' }
    }

    if (!frontmatter.description) {
      return { valid: false, error: 'SKILL.md missing required "description" field' }
    }

    return { valid: true, name: frontmatter.name }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { valid: false, error: 'No SKILL.md found in directory' }
    }
    return { valid: false, error: `Failed to read SKILL.md: ${error}` }
  }
}

/**
 * Install a skill from GitHub
 */
export async function installFromGitHub(source: string): Promise<InstallResult> {
  try {
    const { owner, repo, path: repoPath } = parseGitHubSource(source)

    // Fetch contents from GitHub API
    const apiUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${repoPath}`
    const contents = await fetchGitHubAPI(apiUrl)

    // Check if this is a skill directory (has SKILL.md) or a directory of skills
    const hasSkillMd =
      Array.isArray(contents) &&
      contents.some((item: GitHubContent) => item.name === 'SKILL.md' && item.type === 'file')

    if (hasSkillMd) {
      // This is a single skill - install it
      return await installSingleSkill(contents, source, repoPath.split('/').pop() || repo)
    }

    // Check if it's a directory containing skill folders
    const skillFolders = Array.isArray(contents) ? contents.filter((item: GitHubContent) => item.type === 'dir') : []

    if (skillFolders.length === 0) {
      return { success: false, error: 'No skills found at this location' }
    }

    // For now, return error asking user to be more specific
    // In future, could show a picker UI
    const folderNames = skillFolders.map((f: GitHubContent) => f.name).join(', ')
    return {
      success: false,
      error: `Multiple skill folders found: ${folderNames}. Please specify which skill to install (e.g., "${source}/folder-name")`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Install a single skill from GitHub contents
 */
async function installSingleSkill(
  contents: GitHubContent[],
  source: string,
  fallbackName: string
): Promise<InstallResult> {
  const skillsDir = skillRegistry.getSkillsDirectory()

  // Create temp directory
  const tempDir = path.join(skillsDir, `.installing-${Date.now()}`)

  try {
    // Download all files
    await downloadDirectory(contents, tempDir)

    // Validate
    const validation = await validateSkillDirectory(tempDir)
    if (!validation.valid) {
      await fs.rm(tempDir, { recursive: true, force: true })
      return { success: false, error: validation.error }
    }

    const skillName = validation.name || fallbackName
    const targetDir = path.join(skillsDir, skillName)

    // Check if already installed
    if (await directoryExists(targetDir)) {
      await fs.rm(tempDir, { recursive: true, force: true })
      return { success: false, error: `Skill "${skillName}" is already installed` }
    }

    // Move to final location
    await fs.rename(tempDir, targetDir)

    // Write metadata
    const metaPath = path.join(targetDir, '.skill-meta.json')
    const meta = {
      installedAt: new Date().toISOString(),
      installedFrom: `github:${source}`,
      enabled: true,
    }
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

    // Reload registry
    await skillRegistry.reload()

    return { success: true, skillName }
  } catch (error) {
    // Cleanup on failure
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {}

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Install a skill from a local folder
 */
export async function installFromLocal(sourcePath: string): Promise<InstallResult> {
  try {
    // Validate source
    const validation = await validateSkillDirectory(sourcePath)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const skillName = validation.name!
    const skillsDir = skillRegistry.getSkillsDirectory()
    const targetDir = path.join(skillsDir, skillName)

    // Check if already installed
    if (await directoryExists(targetDir)) {
      return { success: false, error: `Skill "${skillName}" is already installed` }
    }

    // Copy directory
    await copyDirectory(sourcePath, targetDir)

    // Write metadata
    const metaPath = path.join(targetDir, '.skill-meta.json')
    const meta = {
      installedAt: new Date().toISOString(),
      installedFrom: 'local',
      enabled: true,
    }
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

    // Reload registry
    await skillRegistry.reload()

    return { success: true, skillName }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Fetch catalog of available skills from anthropics/skills repo
 */
export async function fetchSkillsCatalog(): Promise<CatalogSkill[]> {
  try {
    // Fetch the skills directory from anthropics/skills
    const apiUrl = `${GITHUB_API_BASE}/repos/anthropics/skills/contents/skills`
    const contents = await fetchGitHubAPI(apiUrl)

    const skills: CatalogSkill[] = []

    for (const item of contents) {
      if (item.type !== 'dir') continue

      // Fetch SKILL.md to get description
      try {
        const skillMdUrl = `${GITHUB_API_BASE}/repos/anthropics/skills/contents/skills/${item.name}/SKILL.md`
        const skillMdMeta = await fetchGitHubAPI(skillMdUrl)

        if (skillMdMeta.download_url) {
          const content = await downloadFile(skillMdMeta.download_url)
          const match = content.match(/^---\n([\s\S]*?)\n---/)

          if (match) {
            const frontmatter = yaml.parse(match[1])

            skills.push({
              name: frontmatter.name || item.name,
              description: frontmatter.description || 'No description',
              path: `skills/${item.name}`,
            })
          }
        }
      } catch {
        // Skip skills that fail to parse
      }
    }

    return skills
  } catch (error) {
    console.error('[SkillInstaller] Failed to fetch catalog:', error)
    return []
  }
}

// ============================================================================
// ClawdHub Installation
// ============================================================================

const CLAWDHUB_DOWNLOAD_BASE = 'https://auth.clawdhub.com/api/v1/download'

/**
 * Parse ClawdHub page URL to extract slug
 * https://clawdhub.com/owner/slug -> slug
 */
function parseClawdHubUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/clawdhub\.com\/[^\/]+\/([^\/\?\#]+)/)
  return match ? match[1] : null
}

/**
 * Check if URL is a ClawdHub page URL
 */
export function isClawdHubUrl(url: string): boolean {
  return /^https?:\/\/clawdhub\.com\/[^\/]+\/[^\/]+/.test(url)
}

/**
 * Download a zip file from URL and return as Buffer
 */
async function downloadZipFile(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!response.ok) {
    throw new Error(`Failed to download zip: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Install a skill from a zip URL (generic)
 */
export async function installFromZipUrl(zipUrl: string, sourceLabel: string): Promise<InstallResult> {
  const skillsDir = skillRegistry.getSkillsDirectory()
  const tempDir = path.join(skillsDir, `.installing-zip-${Date.now()}`)

  try {
    // Download zip
    // console.log(`[SkillInstaller] Downloading zip from: ${zipUrl}`)
    const zipBuffer = await downloadZipFile(zipUrl)

    // Extract zip
    // console.log(`[SkillInstaller] Extracting zip...`)
    const zip = new AdmZip(zipBuffer)
    zip.extractAllTo(tempDir, true)

    // Check if zip extracted to a single subdirectory (common pattern)
    const entries = await fs.readdir(tempDir, { withFileTypes: true })
    let skillSourceDir = tempDir

    // If there's exactly one directory and no files, use that as the source
    const dirs = entries.filter(e => e.isDirectory())
    const files = entries.filter(e => e.isFile())
    if (dirs.length === 1 && files.length === 0) {
      skillSourceDir = path.join(tempDir, dirs[0].name)
    }

    // Validate
    const validation = await validateSkillDirectory(skillSourceDir)
    if (!validation.valid) {
      await fs.rm(tempDir, { recursive: true, force: true })
      return { success: false, error: validation.error }
    }

    const skillName = validation.name!
    const targetDir = path.join(skillsDir, skillName)

    // Check if already installed
    if (await directoryExists(targetDir)) {
      await fs.rm(tempDir, { recursive: true, force: true })
      return { success: false, error: `Skill "${skillName}" is already installed` }
    }

    // Move to final location
    await fs.rename(skillSourceDir, targetDir)

    // Clean up temp dir if we used a subdirectory
    if (skillSourceDir !== tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true })
    }

    // Write metadata
    const metaPath = path.join(targetDir, '.skill-meta.json')
    const meta = {
      installedAt: new Date().toISOString(),
      installedFrom: sourceLabel,
      enabled: true,
    }
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

    // Reload registry
    await skillRegistry.reload()

    console.log(`[SkillInstaller] Successfully installed skill: ${skillName}`)
    return { success: true, skillName }
  } catch (error) {
    // Cleanup on failure
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {}

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Install a skill from ClawdHub page URL
 * https://clawdhub.com/owner/slug -> downloads from auth.clawdhub.com/api/v1/download?slug=slug
 */
export async function installFromClawdHub(pageUrl: string): Promise<InstallResult> {
  const slug = parseClawdHubUrl(pageUrl)
  if (!slug) {
    return { success: false, error: 'Invalid ClawdHub URL. Expected format: https://clawdhub.com/owner/skill-slug' }
  }

  const downloadUrl = `${CLAWDHUB_DOWNLOAD_BASE}?slug=${encodeURIComponent(slug)}`
  console.log(`[SkillInstaller] ClawdHub URL detected. Slug: ${slug}, Download URL: ${downloadUrl}`)

  return installFromZipUrl(downloadUrl, `clawdhub:${slug}`)
}

/**
 * Install from any URL - auto-detects source type
 */
export async function installFromUrl(url: string): Promise<InstallResult> {
  // ClawdHub page URL
  if (isClawdHubUrl(url)) {
    return installFromClawdHub(url)
  }

  // GitHub URL
  if (url.includes('github.com')) {
    return installFromGitHub(url)
  }

  // Direct zip URL (fallback)
  if (url.endsWith('.zip') || url.includes('/download')) {
    return installFromZipUrl(url, `url:${url}`)
  }

  return {
    success: false,
    error: 'Unsupported URL format. Supported: ClawdHub page URLs, GitHub URLs, or direct zip URLs',
  }
}

// ============================================================================
// Helper functions
// ============================================================================

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath)
    } else {
      await fs.copyFile(srcPath, destPath)
    }
  }
}
