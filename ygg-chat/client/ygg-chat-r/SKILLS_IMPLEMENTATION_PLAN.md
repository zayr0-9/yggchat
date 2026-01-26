# Agent Skills Implementation Plan

## Overview

This document describes how to implement the [Agent Skills Specification](https://agentskills.io/specification) in the Ygg-Chat Electron application. Skills are folders containing a `SKILL.md` file with instructions that get injected into the AI's context to teach it specialized tasks.

**Key Distinction**: Skills are NOT executable tools. They are "prompt plugins" - markdown instructions loaded into the LLM context. The AI still uses existing tools (bash, read_file, etc.) to act on skill instructions.

## Reference Documentation

- Agent Skills Spec: https://agentskills.io/specification
- Anthropic Skills Repo: https://github.com/anthropics/skills
- Existing custom tools implementation: `electron/tools/customToolLoader.ts`

---

## File Structure

### New Files to Create

```
electron/
├── skills/
│   ├── skillLoader.ts          # Discovery, parsing, validation
│   ├── skillInstaller.ts       # GitHub fetching, local import
│   ├── skillRoutes.ts          # Express routes for localServer
│   └── skillManager.ts         # Built-in tool for AI to manage skills
```

### Storage Location

```
~/.config/ygg-chat-r/           # Linux (app.getPath('userData'))
%APPDATA%/ygg-chat-r/           # Windows
~/Library/Application Support/ygg-chat-r/  # macOS

└── skills/                     # Skills directory
    ├── SKILLS_GUIDE.md         # User documentation (seeded on first run)
    ├── code-review/            # Example installed skill
    │   ├── SKILL.md            # Required
    │   ├── scripts/            # Optional
    │   ├── references/         # Optional
    │   └── assets/             # Optional
    └── pdf-processing/
        └── SKILL.md
```

---

## Data Structures

### SkillDefinition Interface

```typescript
// electron/skills/skillLoader.ts

export interface SkillDefinition {
  // From SKILL.md frontmatter (required)
  name: string                      // Must match folder name, lowercase + hyphens only
  description: string               // Max 1024 chars, used for AI to decide relevance

  // From SKILL.md frontmatter (optional)
  license?: string
  compatibility?: string            // Environment requirements
  metadata?: Record<string, string> // Arbitrary key-value pairs
  allowedTools?: string[]           // Pre-approved tools (experimental)

  // Computed by loader
  sourcePath: string                // Absolute path to skill directory
  bodyContent: string               // Markdown content after frontmatter
  hasScripts: boolean               // scripts/ directory exists
  hasReferences: boolean            // references/ directory exists
  hasAssets: boolean                // assets/ directory exists
  enabled: boolean                  // User can disable skills
  installedAt: string               // ISO timestamp
  installedFrom?: string            // GitHub source or 'local'
}

export interface SkillSummary {
  name: string
  description: string
  enabled: boolean
}

export interface SkillResource {
  path: string                      // Relative path within skill (e.g., "references/FORMS.md")
  content: string                   // File content
  type: 'script' | 'reference' | 'asset'
}
```

### Installation Metadata

```typescript
// Stored in each skill folder as .skill-meta.json
interface SkillMetadata {
  installedAt: string               // ISO timestamp
  installedFrom: string             // "github:anthropics/skills/skills/code-review" or "local"
  version?: string                  // From metadata.version if present
  enabled: boolean
}
```

---

## Implementation Details

### 1. skillLoader.ts

**Purpose**: Discover and parse skills from the skills directory.

```typescript
// electron/skills/skillLoader.ts

import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import yaml from 'yaml'  // npm install yaml

const SKILLS_DIR_NAME = 'skills'
const SKILL_FILE = 'SKILL.md'
const META_FILE = '.skill-meta.json'
const SKILLS_GUIDE_FILE = 'SKILLS_GUIDE.md'

// Regex to extract YAML frontmatter
const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/

class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map()
  private initialized = false
  private initPromise: Promise<void> | null = null

  /**
   * Get the skills directory path
   */
  getSkillsDirectory(): string {
    return path.join(app.getPath('userData'), SKILLS_DIR_NAME)
  }

  /**
   * Initialize the registry - scan and load all skills
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this._doInitialize()
    await this.initPromise
    this.initPromise = null
  }

  private async _doInitialize(): Promise<void> {
    const skillsDir = this.getSkillsDirectory()

    // Ensure directory exists
    await fs.mkdir(skillsDir, { recursive: true })

    // Seed guide file if not exists
    await this.ensureGuideFile()

    // Load all skills
    await this.loadAllSkills()

    this.initialized = true
    console.log(`[SkillLoader] Initialized ${this.skills.size} skills`)
  }

  private async ensureGuideFile(): Promise<void> {
    const targetPath = path.join(this.getSkillsDirectory(), SKILLS_GUIDE_FILE)

    try {
      await fs.access(targetPath)
      return // Already exists
    } catch {
      // Create default guide
      const guideContent = `# Ygg-Chat Skills

Skills are folders containing instructions that teach the AI how to perform specialized tasks.

## Installing Skills

Use the Skills settings panel in the app to:
- Browse and install skills from GitHub
- Import local skill folders
- Enable/disable installed skills

## Creating Your Own Skills

Each skill is a folder containing at minimum a \`SKILL.md\` file:

\`\`\`
my-skill/
├── SKILL.md          # Required - instructions and metadata
├── scripts/          # Optional - executable scripts
├── references/       # Optional - additional documentation
└── assets/           # Optional - templates, images, data files
\`\`\`

### SKILL.md Format

\`\`\`markdown
---
name: my-skill
description: A clear description of what this skill does and when to use it.
---

# My Skill Instructions

Step-by-step instructions for the AI to follow...
\`\`\`

## Learn More

- Agent Skills Specification: https://agentskills.io/specification
- Official Skills Repository: https://github.com/anthropics/skills
`
      await fs.writeFile(targetPath, guideContent, 'utf-8')
    }
  }

  private async loadAllSkills(): Promise<void> {
    this.skills.clear()
    const skillsDir = this.getSkillsDirectory()

    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await this.loadSkill(entry.name)
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[SkillLoader] Error scanning skills directory:', error)
      }
    }
  }

  private async loadSkill(skillDirName: string): Promise<void> {
    const skillPath = path.join(this.getSkillsDirectory(), skillDirName)
    const skillFilePath = path.join(skillPath, SKILL_FILE)
    const metaFilePath = path.join(skillPath, META_FILE)

    try {
      // Read SKILL.md
      const skillContent = await fs.readFile(skillFilePath, 'utf-8')

      // Parse frontmatter
      const match = skillContent.match(FRONTMATTER_REGEX)
      if (!match) {
        console.warn(`[SkillLoader] Invalid SKILL.md format in ${skillDirName}: missing frontmatter`)
        return
      }

      const [, frontmatterRaw, bodyContent] = match
      let frontmatter: any

      try {
        frontmatter = yaml.parse(frontmatterRaw)
      } catch (parseError) {
        console.warn(`[SkillLoader] Invalid YAML frontmatter in ${skillDirName}:`, parseError)
        return
      }

      // Validate required fields
      if (!frontmatter.name || typeof frontmatter.name !== 'string') {
        console.warn(`[SkillLoader] Missing or invalid 'name' in ${skillDirName}`)
        return
      }

      if (!frontmatter.description || typeof frontmatter.description !== 'string') {
        console.warn(`[SkillLoader] Missing or invalid 'description' in ${skillDirName}`)
        return
      }

      // Validate name format (lowercase, hyphens, no consecutive hyphens)
      if (!/^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/.test(frontmatter.name)) {
        console.warn(`[SkillLoader] Invalid name format in ${skillDirName}: must be lowercase with hyphens`)
        return
      }

      // Name should match directory
      if (frontmatter.name !== skillDirName) {
        console.warn(`[SkillLoader] Skill name "${frontmatter.name}" doesn't match directory "${skillDirName}"`)
        // Continue anyway but log warning
      }

      // Check for optional directories
      const hasScripts = await this.directoryExists(path.join(skillPath, 'scripts'))
      const hasReferences = await this.directoryExists(path.join(skillPath, 'references'))
      const hasAssets = await this.directoryExists(path.join(skillPath, 'assets'))

      // Load metadata if exists
      let meta: Partial<SkillMetadata> = { enabled: true }
      try {
        const metaContent = await fs.readFile(metaFilePath, 'utf-8')
        meta = JSON.parse(metaContent)
      } catch {
        // No metadata file, use defaults
      }

      // Build definition
      const definition: SkillDefinition = {
        name: frontmatter.name,
        description: frontmatter.description,
        license: frontmatter.license,
        compatibility: frontmatter.compatibility,
        metadata: frontmatter.metadata,
        allowedTools: frontmatter['allowed-tools']?.split(' ').filter(Boolean),
        sourcePath: skillPath,
        bodyContent: bodyContent.trim(),
        hasScripts,
        hasReferences,
        hasAssets,
        enabled: meta.enabled !== false,
        installedAt: meta.installedAt || new Date().toISOString(),
        installedFrom: meta.installedFrom,
      }

      this.skills.set(frontmatter.name, definition)
      console.log(`[SkillLoader] Loaded skill: ${frontmatter.name}`)

    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`[SkillLoader] No SKILL.md found in ${skillDirName}`)
      } else {
        console.warn(`[SkillLoader] Failed to load skill ${skillDirName}:`, error)
      }
    }
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Get all skill summaries (for listing)
   */
  getSummaries(): SkillSummary[] {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      enabled: s.enabled,
    }))
  }

  /**
   * Get full skill definition (for activation)
   */
  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name)
  }

  /**
   * Check if skill exists
   */
  hasSkill(name: string): boolean {
    return this.skills.has(name)
  }

  /**
   * Get all enabled skills
   */
  getEnabledSkills(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(s => s.enabled)
  }

  /**
   * Enable/disable a skill
   */
  async setSkillEnabled(name: string, enabled: boolean): Promise<boolean> {
    const skill = this.skills.get(name)
    if (!skill) return false

    skill.enabled = enabled

    // Persist to metadata file
    const metaPath = path.join(skill.sourcePath, META_FILE)
    const meta: SkillMetadata = {
      installedAt: skill.installedAt,
      installedFrom: skill.installedFrom || 'local',
      enabled,
    }

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    return true
  }

  /**
   * Load a resource file from a skill
   */
  async loadResource(skillName: string, resourcePath: string): Promise<SkillResource | null> {
    const skill = this.skills.get(skillName)
    if (!skill) return null

    // Security: prevent path traversal
    const normalizedPath = path.normalize(resourcePath)
    if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
      console.warn(`[SkillLoader] Invalid resource path: ${resourcePath}`)
      return null
    }

    const fullPath = path.join(skill.sourcePath, normalizedPath)

    // Ensure path is within skill directory
    if (!fullPath.startsWith(skill.sourcePath)) {
      console.warn(`[SkillLoader] Resource path escapes skill directory: ${resourcePath}`)
      return null
    }

    try {
      const content = await fs.readFile(fullPath, 'utf-8')

      // Determine type based on path
      let type: 'script' | 'reference' | 'asset' = 'asset'
      if (normalizedPath.startsWith('scripts/')) type = 'script'
      else if (normalizedPath.startsWith('references/')) type = 'reference'

      return { path: resourcePath, content, type }
    } catch {
      return null
    }
  }

  /**
   * Reload all skills
   */
  async reload(): Promise<void> {
    console.log('[SkillLoader] Reloading skills...')
    this.initialized = false
    await this.initialize()
  }

  /**
   * Uninstall a skill
   */
  async uninstallSkill(name: string): Promise<boolean> {
    const skill = this.skills.get(name)
    if (!skill) return false

    try {
      await fs.rm(skill.sourcePath, { recursive: true, force: true })
      this.skills.delete(name)
      return true
    } catch (error) {
      console.error(`[SkillLoader] Failed to uninstall skill ${name}:`, error)
      return false
    }
  }
}

// Singleton export
export const skillRegistry = new SkillRegistry()
```

---

### 2. skillInstaller.ts

**Purpose**: Install skills from GitHub or local folders.

```typescript
// electron/skills/skillInstaller.ts

import fs from 'fs/promises'
import path from 'path'
import { skillRegistry } from './skillLoader.js'

interface GitHubContent {
  name: string
  path: string
  type: 'file' | 'dir'
  download_url: string | null
  url: string  // API URL for directories
}

interface InstallResult {
  success: boolean
  skillName?: string
  error?: string
}

interface CatalogSkill {
  name: string
  description: string
  path: string  // Path within repo (e.g., "skills/code-review")
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
      'Accept': 'application/vnd.github.v3+json',
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
async function downloadDirectory(
  contents: GitHubContent[],
  targetDir: string
): Promise<void> {
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
    const yaml = await import('yaml')
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
    const hasSkillMd = Array.isArray(contents) &&
      contents.some((item: GitHubContent) => item.name === 'SKILL.md' && item.type === 'file')

    if (hasSkillMd) {
      // This is a single skill - install it
      return await installSingleSkill(contents, source, repoPath.split('/').pop() || repo)
    }

    // Check if it's a directory containing skill folders
    const skillFolders = Array.isArray(contents) ?
      contents.filter((item: GitHubContent) => item.type === 'dir') : []

    if (skillFolders.length === 0) {
      return { success: false, error: 'No skills found at this location' }
    }

    // For now, return error asking user to be more specific
    // In future, could show a picker UI
    const folderNames = skillFolders.map((f: GitHubContent) => f.name).join(', ')
    return {
      success: false,
      error: `Multiple skill folders found: ${folderNames}. Please specify which skill to install (e.g., "${source}/folder-name")`
    }

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
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
      error: error instanceof Error ? error.message : String(error)
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
      error: error instanceof Error ? error.message : String(error)
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
            const yaml = await import('yaml')
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

// Helper functions
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
```

---

### 3. skillRoutes.ts

**Purpose**: Express routes for the local server API.

```typescript
// electron/skills/skillRoutes.ts

import { Express } from 'express'
import { skillRegistry } from './skillLoader.js'
import { installFromGitHub, installFromLocal, fetchSkillsCatalog } from './skillInstaller.js'

export function registerSkillRoutes(app: Express): void {

  // GET /api/skills - List all installed skills (summaries)
  app.get('/api/skills', async (_req, res) => {
    try {
      await skillRegistry.initialize()
      const skills = skillRegistry.getSummaries()
      res.json({
        success: true,
        skills,
        totalCount: skills.length,
        skillsDirectory: skillRegistry.getSkillsDirectory(),
      })
    } catch (error) {
      console.error('[SkillRoutes] Error listing skills:', error)
      res.status(500).json({ success: false, error: 'Failed to list skills' })
    }
  })

  // GET /api/skills/catalog - Fetch available skills from anthropics/skills
  app.get('/api/skills/catalog', async (_req, res) => {
    try {
      const catalog = await fetchSkillsCatalog()
      res.json({ success: true, skills: catalog })
    } catch (error) {
      console.error('[SkillRoutes] Error fetching catalog:', error)
      res.status(500).json({ success: false, error: 'Failed to fetch skills catalog' })
    }
  })

  // GET /api/skills/:name - Get full skill content (for activation)
  app.get('/api/skills/:name', async (req, res) => {
    try {
      await skillRegistry.initialize()
      const skill = skillRegistry.getSkill(req.params.name)

      if (!skill) {
        res.status(404).json({ success: false, error: 'Skill not found' })
        return
      }

      res.json({ success: true, skill })
    } catch (error) {
      console.error('[SkillRoutes] Error getting skill:', error)
      res.status(500).json({ success: false, error: 'Failed to get skill' })
    }
  })

  // GET /api/skills/:name/resource - Load a resource file from skill
  app.get('/api/skills/:name/resource', async (req, res) => {
    try {
      await skillRegistry.initialize()
      const resourcePath = req.query.path as string

      if (!resourcePath) {
        res.status(400).json({ success: false, error: 'Missing "path" query parameter' })
        return
      }

      const resource = await skillRegistry.loadResource(req.params.name, resourcePath)

      if (!resource) {
        res.status(404).json({ success: false, error: 'Resource not found' })
        return
      }

      res.json({ success: true, resource })
    } catch (error) {
      console.error('[SkillRoutes] Error loading resource:', error)
      res.status(500).json({ success: false, error: 'Failed to load resource' })
    }
  })

  // POST /api/skills/:name/enable - Enable a skill
  app.post('/api/skills/:name/enable', async (req, res) => {
    try {
      await skillRegistry.initialize()
      const success = await skillRegistry.setSkillEnabled(req.params.name, true)

      if (!success) {
        res.status(404).json({ success: false, error: 'Skill not found' })
        return
      }

      res.json({ success: true })
    } catch (error) {
      console.error('[SkillRoutes] Error enabling skill:', error)
      res.status(500).json({ success: false, error: 'Failed to enable skill' })
    }
  })

  // POST /api/skills/:name/disable - Disable a skill
  app.post('/api/skills/:name/disable', async (req, res) => {
    try {
      await skillRegistry.initialize()
      const success = await skillRegistry.setSkillEnabled(req.params.name, false)

      if (!success) {
        res.status(404).json({ success: false, error: 'Skill not found' })
        return
      }

      res.json({ success: true })
    } catch (error) {
      console.error('[SkillRoutes] Error disabling skill:', error)
      res.status(500).json({ success: false, error: 'Failed to disable skill' })
    }
  })

  // POST /api/skills/install/github - Install from GitHub
  app.post('/api/skills/install/github', async (req, res) => {
    try {
      const { source } = req.body

      if (!source || typeof source !== 'string') {
        res.status(400).json({ success: false, error: 'Missing "source" in request body' })
        return
      }

      const result = await installFromGitHub(source)

      if (result.success) {
        res.json({ success: true, skillName: result.skillName })
      } else {
        res.status(400).json({ success: false, error: result.error })
      }
    } catch (error) {
      console.error('[SkillRoutes] Error installing from GitHub:', error)
      res.status(500).json({ success: false, error: 'Failed to install skill' })
    }
  })

  // POST /api/skills/install/local - Install from local folder
  app.post('/api/skills/install/local', async (req, res) => {
    try {
      const { path: sourcePath } = req.body

      if (!sourcePath || typeof sourcePath !== 'string') {
        res.status(400).json({ success: false, error: 'Missing "path" in request body' })
        return
      }

      const result = await installFromLocal(sourcePath)

      if (result.success) {
        res.json({ success: true, skillName: result.skillName })
      } else {
        res.status(400).json({ success: false, error: result.error })
      }
    } catch (error) {
      console.error('[SkillRoutes] Error installing from local:', error)
      res.status(500).json({ success: false, error: 'Failed to install skill' })
    }
  })

  // DELETE /api/skills/:name - Uninstall a skill
  app.delete('/api/skills/:name', async (req, res) => {
    try {
      await skillRegistry.initialize()
      const success = await skillRegistry.uninstallSkill(req.params.name)

      if (!success) {
        res.status(404).json({ success: false, error: 'Skill not found' })
        return
      }

      res.json({ success: true })
    } catch (error) {
      console.error('[SkillRoutes] Error uninstalling skill:', error)
      res.status(500).json({ success: false, error: 'Failed to uninstall skill' })
    }
  })

  // POST /api/skills/reload - Reload all skills
  app.post('/api/skills/reload', async (_req, res) => {
    try {
      await skillRegistry.reload()
      const skills = skillRegistry.getSummaries()
      res.json({ success: true, skills, totalCount: skills.length })
    } catch (error) {
      console.error('[SkillRoutes] Error reloading skills:', error)
      res.status(500).json({ success: false, error: 'Failed to reload skills' })
    }
  })

  console.log('[SkillRoutes] Registered skill routes')
}
```

---

### 4. skillManager.ts

**Purpose**: Built-in tool for the AI to discover and activate skills.

```typescript
// electron/skills/skillManager.ts

import { skillRegistry, SkillDefinition, SkillSummary } from './skillLoader.js'

interface SkillManagerArgs {
  action: 'list' | 'activate' | 'load_resource'
  name?: string           // For 'activate' and 'load_resource'
  resourcePath?: string   // For 'load_resource' (e.g., "references/FORMS.md")
}

interface SkillManagerResult {
  success: boolean
  error?: string

  // For 'list' action
  skills?: SkillSummary[]
  totalCount?: number

  // For 'activate' action
  skill?: {
    name: string
    description: string
    instructions: string      // The bodyContent from SKILL.md
    hasScripts: boolean
    hasReferences: boolean
    hasAssets: boolean
  }

  // For 'load_resource' action
  resource?: {
    path: string
    content: string
    type: 'script' | 'reference' | 'asset'
  }
}

/**
 * Execute the skill_manager tool
 * This is called by the AI to discover and activate skills
 */
export async function execute(args: SkillManagerArgs): Promise<SkillManagerResult> {
  const { action, name, resourcePath } = args

  // Ensure registry is initialized
  await skillRegistry.initialize()

  if (action === 'list') {
    const skills = skillRegistry.getSummaries()
      .filter(s => s.enabled)  // Only show enabled skills to AI

    return {
      success: true,
      skills,
      totalCount: skills.length,
    }
  }

  if (action === 'activate') {
    if (!name) {
      return { success: false, error: 'Missing "name" parameter for activate action' }
    }

    const skill = skillRegistry.getSkill(name)
    if (!skill) {
      return { success: false, error: `Skill "${name}" not found` }
    }

    if (!skill.enabled) {
      return { success: false, error: `Skill "${name}" is disabled` }
    }

    return {
      success: true,
      skill: {
        name: skill.name,
        description: skill.description,
        instructions: skill.bodyContent,
        hasScripts: skill.hasScripts,
        hasReferences: skill.hasReferences,
        hasAssets: skill.hasAssets,
      },
    }
  }

  if (action === 'load_resource') {
    if (!name) {
      return { success: false, error: 'Missing "name" parameter for load_resource action' }
    }
    if (!resourcePath) {
      return { success: false, error: 'Missing "resourcePath" parameter for load_resource action' }
    }

    const resource = await skillRegistry.loadResource(name, resourcePath)
    if (!resource) {
      return { success: false, error: `Resource "${resourcePath}" not found in skill "${name}"` }
    }

    return {
      success: true,
      resource,
    }
  }

  return { success: false, error: `Unknown action: ${action}` }
}

/**
 * Get the tool definition for skill_manager
 * This should be added to your toolDefinitions
 */
export const skillManagerDefinition = {
  name: 'skill_manager',
  description: `Discover and activate specialized skills that provide detailed instructions for specific tasks.

Use this tool to:
1. List available skills with action: "list"
2. Activate a skill to load its instructions with action: "activate" and name: "skill-name"
3. Load additional resources (scripts, references, assets) with action: "load_resource"

Skills are context injections - they provide detailed instructions that you should follow.
After activating a skill, incorporate its instructions into your approach for the current task.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'activate', 'load_resource'],
        description: 'The action to perform',
      },
      name: {
        type: 'string',
        description: 'Skill name (required for activate and load_resource)',
      },
      resourcePath: {
        type: 'string',
        description: 'Path to resource file within the skill (e.g., "references/FORMS.md")',
      },
    },
    required: ['action'],
  },
}
```

---

## Integration Points

### 1. Register Routes in localServer.ts

Add this near the other route registrations in `setupServer()`:

```typescript
// In electron/localServer.ts, inside setupServer()

import { registerSkillRoutes } from './skills/skillRoutes.js'

// ... existing code ...

function setupServer() {
  // ... existing CORS and middleware setup ...

  // Register skill routes
  registerSkillRoutes(app)

  // ... rest of existing routes ...
}
```

### 2. Register Built-in Tool in localServer.ts

Add skill_manager to the built-in tools in `initializeBuiltInToolRegistry()`:

```typescript
// In electron/localServer.ts, inside initializeBuiltInToolRegistry()

import { execute as executeSkillManager } from './skills/skillManager.js'

// ... inside initializeBuiltInToolRegistry() ...

builtInTools.set('skill_manager', async (args) => {
  return await executeSkillManager(args)
})
```

### 3. Add Tool Definition

Add the skill_manager tool definition to wherever your tool definitions are stored (likely sent to the frontend/API):

```typescript
// Add to your tool definitions list
import { skillManagerDefinition } from './skills/skillManager.js'

// Include in the list of available tools
const allToolDefinitions = [
  // ... existing tools ...
  skillManagerDefinition,
]
```

### 4. System Prompt Injection (Optional Enhancement)

To help the AI know about skills without calling the tool first, you can inject skill summaries into the system prompt:

```typescript
// When building system prompt for API calls

import { skillRegistry } from './skills/skillLoader.js'

async function buildSystemPrompt(basePrompt: string): Promise<string> {
  await skillRegistry.initialize()
  const skills = skillRegistry.getSummaries().filter(s => s.enabled)

  if (skills.length === 0) {
    return basePrompt
  }

  const skillList = skills
    .map(s => `- ${s.name}: ${s.description}`)
    .join('\n')

  const skillSection = `
## Available Skills

The following skills are available. Use the skill_manager tool to activate one when relevant:

${skillList}

To use a skill, call skill_manager with action: "activate" and the skill name.
`

  return basePrompt + skillSection
}
```

---

## Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "yaml": "^2.3.4"
  }
}
```

Run: `npm install yaml`

---

## Testing Checklist

1. **Skill Loading**
   - [ ] Skills directory created on first run
   - [ ] SKILLS_GUIDE.md seeded
   - [ ] Valid skills loaded correctly
   - [ ] Invalid skills (bad frontmatter) logged and skipped
   - [ ] Skill enable/disable persists

2. **GitHub Installation**
   - [ ] Install single skill from `owner/repo/path`
   - [ ] Install from full URL
   - [ ] Handle rate limiting gracefully
   - [ ] Handle 404 errors
   - [ ] Validate SKILL.md before completing install

3. **Local Installation**
   - [ ] Import from local folder
   - [ ] Validate SKILL.md exists
   - [ ] Copy all files including subdirectories

4. **API Routes**
   - [ ] GET /api/skills returns list
   - [ ] GET /api/skills/:name returns full skill
   - [ ] GET /api/skills/:name/resource loads files
   - [ ] POST install endpoints work
   - [ ] DELETE uninstalls skill

5. **AI Tool**
   - [ ] skill_manager list action works
   - [ ] skill_manager activate action returns instructions
   - [ ] skill_manager load_resource works

---

## Future Enhancements (Not in Initial Implementation)

1. **Manual skill forcing** - UI to force a skill active for conversation
2. **Skill updates** - Check if installed skills have newer versions
3. **Private repos** - Support GitHub token for private repos
4. **Skill search** - Search skill marketplaces beyond anthropics/skills
5. **Skill versioning** - Track and manage skill versions
6. **Skill dependencies** - Skills that require other skills
