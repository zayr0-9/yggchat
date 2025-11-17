import { z } from 'zod/v4'
// src/utils/tools/toolRegistry.ts
// import { z } from 'zod/v4'
import { braveSearch } from './core/braveSearch'
import { browseWeb } from './core/browseWeb'
import { createTextFile } from './core/createFile'
import { deleteFile, safeDeleteFile } from './core/deleteFile'
import { editFile } from './core/editFile'
import { extractDirectoryStructure } from './core/getDirectoryTree'
import { globSearch } from './core/glob'
import { readFileContinuation, readTextFile } from './core/readFile'
import { readMultipleTextFiles } from './core/readFiles'
import { ripgrepSearch } from './core/ripgrep'
import searchHistory from './core/searchHistory'
// export const directoryTool = tool({
//   description:
//     'Get the directory structure of a specified path. Useful for understanding project organization, finding files, or exploring codebases.',
//   parameters: z.object({
//     path: z.string().describe('The directory path to analyze (absolute or relative)'),
//   }),
//   execute: async ({ path }) => {
//     try {
//       const structure = await extractDirectoryStructure(path)
//       return {
//         success: true,
//         structure,
//         path: path,
//       }
//     } catch (error) {
//       return {
//         success: false,
//         error: error instanceof Error ? error.message : 'Unknown error occurred',
//         path: path,
//       }
//     }
//   },
// })

// export const tools = {
//   getDirectory: directoryTool,
// }

interface tools {
  name: string
  enabled: boolean
  tool: {
    description: string
    inputSchema: any
    execute: any
  }
}

const tools: tools[] = [
  {
    name: 'directory',
    enabled: false,
    tool: {
      description:
        'Get the directory structure of a specified path. Useful for understanding project organization, finding files, or exploring codebases.',
      inputSchema: z.object({
        path: z.string().describe('The directory path to analyze (absolute or relative)'),
      }),
      execute: async ({ path }: { path: string }) => {
        try {
          const structure = await extractDirectoryStructure(path)
          return {
            success: true,
            structure,
            path: path,
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            path: path,
          }
        }
      },
    },
  },
  {
    name: 'read_file',
    enabled: false,
    tool: {
      description:
        'Read the contents of a text file (code, config, docs). Supports reading full files, single ranges, or multiple disjoint ranges. Rejects likely-binary files and truncates large files for safety.',
      inputSchema: z.object({
        path: z.string().describe('The file path to read (absolute or relative)'),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(5 * 1024 * 1024)
          .optional()
          .describe('Optional safety limit on bytes to read (1 to 5MB); defaults to 204800 (200KB)'),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Optional 1-based line number to start reading from (inclusive). Use for single range reads. Ignored if ranges is provided.'
          ),
        endLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Optional 1-based line number to stop reading at (inclusive). Use with startLine for single range. Ignored if ranges is provided.'
          ),
        ranges: z
          .array(
            z.object({
              startLine: z.number().int().min(1).describe('1-based start line (inclusive)'),
              endLine: z.number().int().min(1).describe('1-based end line (inclusive)'),
            })
          )
          .optional()
          .describe(
            'Optional array of multiple line ranges to read. Each range will be separated with a "// Lines X-Y" comment. Use this to read disjoint sections in a single call, avoiding overlaps and duplicate context.'
          ),
      }),
      execute: async ({
        path,
        maxBytes,
        startLine,
        endLine,
        ranges,
      }: {
        path: string
        maxBytes?: number
        startLine?: number
        endLine?: number
        ranges?: Array<{ startLine: number; endLine: number }>
      }) => {
        try {
          const res = await readTextFile(path, { maxBytes, startLine, endLine, ranges })
          return {
            success: true,
            path,
            absolutePath: res.absolutePath,
            sizeBytes: res.sizeBytes,
            truncated: res.truncated,
            content: res.content,
            startLine: res.startLine,
            endLine: res.endLine,
            totalLines: res.totalLines,
            ranges: res.ranges,
          }
        } catch (error) {
          return {
            success: false,
            path,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
          }
        }
      },
    },
  },
  {
    name: 'read_files',
    enabled: false,
    tool: {
      description:
        "Read multiple text/code/config files and return a single concatenated string, separated by each file's relative path header.",
      inputSchema: z.object({
        paths: z
          .array(z.string())
          .nonempty()
          .describe('Array of file paths to read (absolute or relative), e.g. ["path1", "path2"]'),
        baseDir: z.string().optional().describe('Optional base directory used to compute the relative path header.'),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(5 * 1024 * 1024)
          .optional()
          .describe('Optional per-file safety limit on bytes to read (1 to 5MB); defaults to 204800 (200KB)'),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Optional 1-based line number to start reading from (inclusive). Applies to all files.'),
        endLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Optional 1-based line number to stop reading at (inclusive). Applies to all files.'),
      }),
      execute: async ({
        paths,
        baseDir,
        maxBytes,
        startLine,
        endLine,
      }: {
        paths: string[]
        baseDir?: string
        maxBytes?: number
        startLine?: number
        endLine?: number
      }) => {
        try {
          const res = await readMultipleTextFiles(paths, { baseDir, maxBytes, startLine, endLine })
          return {
            success: true,
            combined: res.combined,
            files: res.files,
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
          }
        }
      },
    },
  },
  {
    name: 'read_file_continuation',
    enabled: false,
    tool: {
      description:
        'Read the next chunk of a file after a specific line number. Designed for pagination to avoid duplicate reads. Use this when you previously read a file up to line N and want to continue reading from line N+1.',
      inputSchema: z.object({
        path: z.string().describe('The file path to read (absolute or relative)'),
        afterLine: z
          .number()
          .int()
          .min(0)
          .describe('1-based line number to start reading after (exclusive). Use 0 to read from the beginning.'),
        numLines: z.number().int().min(1).describe('Number of lines to read after the specified line'),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(5 * 1024 * 1024)
          .optional()
          .describe('Optional safety limit on bytes to read (1 to 5MB); defaults to 204800 (200KB)'),
      }),
      execute: async ({
        path,
        afterLine,
        numLines,
        maxBytes,
      }: {
        path: string
        afterLine: number
        numLines: number
        maxBytes?: number
      }) => {
        try {
          const res = await readFileContinuation(path, afterLine, numLines, { maxBytes })
          return {
            success: true,
            path,
            absolutePath: res.absolutePath,
            sizeBytes: res.sizeBytes,
            truncated: res.truncated,
            content: res.content,
            startLine: res.startLine,
            endLine: res.endLine,
            totalLines: res.totalLines,
          }
        } catch (error) {
          return {
            success: false,
            path,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
          }
        }
      },
    },
  },
  {
    name: 'create_file',
    enabled: false,
    tool: {
      description: 'Create a new text file with optional parent directory creation and overwrite support.',
      inputSchema: z.object({
        path: z.string().describe('File path to create (absolute or relative).'),
        content: z.string().optional().describe('Initial content to write to the file; defaults to empty.'),
        directory: z.string().optional().describe('Optional base directory; resolved when path is relative.'),
        createParentDirs: z
          .boolean()
          .optional()
          .describe('If true, create parent directories as needed (default true).'),
        overwrite: z.boolean().optional().describe('If true, overwrite existing file (default false).'),
        executable: z.boolean().optional().describe('If true, make the file executable on POSIX systems.'),
      }),
      execute: async ({ path, content, directory, createParentDirs, overwrite, executable }: any) => {
        try {
          const res = await createTextFile(path, content ?? '', { directory, createParentDirs, overwrite, executable })
          return res
        } catch (error) {
          return {
            success: false,
            absolutePath: '',
            created: false,
            sizeBytes: 0,
            message: error instanceof Error ? error.message : 'Unknown error occurred',
          }
        }
      },
    },
  },
  {
    name: 'delete_file',
    enabled: false,
    tool: {
      description: 'Delete a file at the specified path. Optionally restrict deletions to specific file extensions.',
      inputSchema: z.object({
        path: z.string().describe('File path to delete (absolute or relative).'),
        allowedExtensions: z
          .array(z.string())
          .optional()
          .describe('Optional array of allowed file extensions (e.g., .txt, .json).'),
      }),
      execute: async ({ path, allowedExtensions }: any) => {
        try {
          if (allowedExtensions && Array.isArray(allowedExtensions) && allowedExtensions.length > 0) {
            await safeDeleteFile(path, allowedExtensions)
          } else {
            await deleteFile(path)
          }

          return {
            success: true,
            path,
          }
        } catch (error) {
          return {
            success: false,
            path,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
          }
        }
      },
    },
  },
  {
    name: 'edit_file',
    enabled: false,
    tool: {
      description:
        'Edit a file using search and replace operations or append content. Supports replacing all occurrences, first occurrence only, or appending.',
      inputSchema: z.object({
        path: z.string().describe('The path to the file to edit'),
        operation: z.enum(['replace', 'replace_first', 'append']).describe('Type of edit operation'),
        searchPattern: z.string().optional().describe('The text pattern to find (required for replace operations)'),
        replacement: z.string().optional().describe('The replacement text (required for replace operations)'),
        content: z.string().optional().describe('Content to append (required for append operation)'),
        createBackup: z.boolean().optional().describe('Whether to create a backup before editing (default false)'),
        encoding: z.string().optional().describe('File encoding (default utf8)'),
      }),
      execute: async ({ path, operation, searchPattern, replacement, content, createBackup, encoding }: any) => {
        return await editFile(path, operation, {
          searchPattern,
          replacement,
          content,
          createBackup,
          encoding,
        })
      },
    },
  },
  {
    name: 'search_history',
    enabled: false,
    tool: {
      description: 'Search chat history across user, project, or conversation using the DB FTS utilities.',
      inputSchema: z.object({
        query: z.string().describe('The search query to run'),
        userId: z.number().int().optional().nullable().describe('Optional user id to scope search'),
        projectId: z.number().int().optional().nullable().describe('Optional project id to scope search'),
        conversationId: z.number().int().optional().nullable().describe('Optional conversation id to scope search'),
        limit: z.number().int().optional().describe('Optional result limit (default 10)'),
      }),
      execute: async ({ query, userId, projectId, conversationId, limit }: any) => {
        try {
          const res = await searchHistory({ query, userId, projectId, conversationId, limit })
          return {
            success: true,
            results: res,
          }
        } catch (err: any) {
          return { success: false, error: err?.message ?? String(err) }
        }
      },
    },
  },
  {
    name: 'brave_search',
    enabled: true,
    tool: {
      description:
        'Search the web using Brave Search API. Returns web search results with titles, URLs, and descriptions.',
      inputSchema: z.object({
        query: z.string().describe('The search query to execute'),
        count: z.number().int().min(1).max(20).optional().describe('Number of results to return (default 10, max 20)'),
        offset: z.number().int().min(0).optional().describe('Number of results to skip (default 0)'),
        safesearch: z.enum(['strict', 'moderate', 'off']).optional().describe('Safe search setting (default moderate)'),
        country: z.string().optional().describe('Country code for localized results (e.g., "US", "GB")'),
        search_lang: z
          .string()
          .optional()
          .describe(
            'Language for search results using Brave-supported codes (e.g., "en", "es", "pt-br", "zh-hant"). Must be one of Brave Search API\'s allowed values: ar, eu, bn, bg, ca, zh-hans, zh-hant, hr, cs, da, nl, en, en-gb, et, fi, fr, gl, de, el, gu, he, hi, hu, is, it, jp, kn, ko, lv, lt, ms, ml, mr, nb, pl, pt-br, pt-pt, pa, ro, ru, sr, sk, sl, es, sv, ta, te, th, tr, uk, or vi.'
          ),
        extra_snippets: z.boolean().optional().describe('Include extra snippets in results'),
        summary: z.boolean().optional().describe('Include AI-generated summary'),
      }),
      execute: async ({ query, count, offset, safesearch, country, search_lang, extra_snippets, summary }: any) => {
        try {
          const res = await braveSearch(query, {
            count,
            offset,
            safesearch,
            country,
            search_lang,
            extra_snippets,
            summary,
          })
          return res
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred during search',
            query,
          }
        }
      },
    },
  },
  {
    name: 'ripgrep',
    enabled: false,
    tool: {
      description:
        'Search code, files, and directories using ripgrep (rg), a powerful line-oriented search tool. Supports regex patterns, file filtering, and various output formats. IMPORTANT: Results have multiple limits to prevent overwhelming output: (1) max 500 match results, (2) max 50,000 total characters across all matches, (3) individual lines truncated at 500 characters. If any limit is exceeded, you will receive an error asking you to narrow your search using more specific patterns, glob filters, reduced search paths, or maxCount parameter.',
      inputSchema: z.object({
        pattern: z.string().describe('Search pattern (regex or literal string)'),
        searchPath: z
          .string()
          .optional()
          .describe('Directory or file path to search (defaults to current directory ".")'),
        caseSensitive: z.boolean().optional().describe('Case-sensitive search (default false for case-insensitive)'),
        lineNumbers: z.boolean().optional().describe('Include line numbers in results (default true)'),
        count: z
          .boolean()
          .optional()
          .describe('Count matches per file instead of showing line content (default false)'),
        filesWithMatches: z.boolean().optional().describe('List only filenames with matches (default false)'),
        maxCount: z.number().int().min(1).optional().describe('Maximum matches per file'),
        glob: z.string().optional().describe('File pattern glob (e.g., "*.ts", "src/**/*.js")'),
        hidden: z.boolean().optional().describe('Search hidden files and directories (default false)'),
        noIgnore: z.boolean().optional().describe('Ignore .gitignore rules (default false)'),
        contextLines: z.number().int().min(0).optional().describe('Show N lines of context before and after matches'),
      }),
      execute: async ({
        pattern,
        searchPath,
        caseSensitive,
        lineNumbers,
        count,
        filesWithMatches,
        maxCount,
        glob,
        hidden,
        noIgnore,
        contextLines,
      }: {
        pattern: string
        searchPath?: string
        caseSensitive?: boolean
        lineNumbers?: boolean
        count?: boolean
        filesWithMatches?: boolean
        maxCount?: number
        glob?: string
        hidden?: boolean
        noIgnore?: boolean
        contextLines?: number
      }) => {
        try {
          const result = await ripgrepSearch(pattern, searchPath ?? '.', {
            caseSensitive,
            lineNumbers,
            count,
            filesWithMatches,
            maxCount,
            glob,
            hidden,
            noIgnore,
            contextLines,
          })
          return result
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred during ripgrep search',
            pattern,
            searchPath,
          }
        }
      },
    },
  },
  {
    name: 'glob',
    enabled: false,
    tool: {
      description: 'Search for files using glob patterns with flexible matching and filtering options',
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern to match files (e.g., "*.ts", "src/**/*.js")'),
        cwd: z.string().optional().describe('Current working directory to search from'),
        ignore: z.string().or(z.array(z.string())).optional().describe('Patterns to ignore'),
        dot: z.boolean().optional().describe('Include dotfiles (default: false)'),
        absolute: z.boolean().optional().describe('Return absolute paths (default: false)'),
        mark: z.boolean().optional().describe('Add / suffix to directories (default: false)'),
        nosort: z.boolean().optional().describe('Do not sort results (default: false)'),
        nocase: z.boolean().optional().describe('Case-insensitive matching on Windows (default: false)'),
        nodir: z.boolean().optional().describe('Do not match directories (default: false)'),
        follow: z.boolean().optional().describe('Follow symbolic links (default: false)'),
        realpath: z.boolean().optional().describe('Return resolved absolute paths (default: false)'),
        stat: z.boolean().optional().describe('Call stat() on all results (default: false)'),
        withFileTypes: z.boolean().optional().describe('Return file type objects instead of paths (default: false)'),
      }),
      execute: async ({
        pattern,
        cwd,
        ignore,
        dot,
        absolute,
        mark,
        nosort,
        nocase,
        nodir,
        follow,
        realpath,
        stat,
        withFileTypes,
      }: any) => {
        try {
          const result = await globSearch(pattern, {
            cwd,
            ignore,
            dot,
            absolute,
            mark,
            nosort,
            nocase,
            nodir,
            follow,
            realpath,
            stat,
            withFileTypes,
          })
          return result
        } catch (error) {
          return {
            success: false,
            matches: [],
            error: error instanceof Error ? error.message : 'Unknown error during glob search',
            pattern,
          }
        }
      },
    },
  },
  {
    name: 'browse_web',
    enabled: false,
    tool: {
      description:
        'Browse a web page and extract its content, including text, headings, links, images, and metadata. Uses Playwright to handle JavaScript-rendered content. Supports both headless and non-headless modes for bot detection avoidance. Use headless mode as default unless specified by user.',
      inputSchema: z.object({
        url: z.string().url().describe('The URL to browse and extract content from'),
        waitForSelector: z.string().optional().describe('Optional CSS selector to wait for before extracting content'),
        timeout: z.number().int().min(5000).max(60000).optional().describe('Timeout in milliseconds (default 30000)'),
        waitForNetworkIdle: z
          .boolean()
          .optional()
          .describe('Wait for network to be idle before extracting (default true)'),
        extractImages: z.boolean().optional().describe('Extract image information (default true)'),
        extractLinks: z.boolean().optional().describe('Extract link information (default true)'),
        extractMetadata: z.boolean().optional().describe('Extract page metadata (default true)'),
        headless: z
          .boolean()
          .optional()
          .describe('Run browser in headless mode (default true). Set to false to avoid bot detection.'),
        useUserProfile: z
          .boolean()
          .optional()
          .describe(
            'Use existing browser profile with your cookies and extensions (default false). Only works with headless=false.'
          ),
        userDataDir: z
          .string()
          .optional()
          .describe(
            'Path to browser user data directory. Required when useUserProfile=true. Example: ~/.config/google-chrome or %LOCALAPPDATA%\\Google\\Chrome\\User Data'
          ),
        retries: z
          .number()
          .int()
          .min(0)
          .max(5)
          .optional()
          .describe('Number of retry attempts if browsing fails (default 2)'),
        retryDelay: z
          .number()
          .int()
          .min(100)
          .max(10000)
          .optional()
          .describe('Delay between retries in milliseconds (default 1000)'),
        useBrave: z.boolean().optional().describe('Use Brave browser instead of Chromium (default false)'),
        executablePath: z.string().optional().describe('Custom path to browser executable (overrides useBrave)'),
      }),
      execute: async ({
        url,
        waitForSelector,
        timeout,
        waitForNetworkIdle,
        extractImages,
        extractLinks,
        extractMetadata,
        headless,
        useUserProfile,
        userDataDir,
        retries,
        retryDelay,
        useBrave,
        executablePath,
      }: {
        url: string
        waitForSelector?: string
        timeout?: number
        waitForNetworkIdle?: boolean
        extractImages?: boolean
        extractLinks?: boolean
        extractMetadata?: boolean
        headless?: boolean
        useUserProfile?: boolean
        userDataDir?: string
        retries?: number
        retryDelay?: number
        useBrave?: boolean
        executablePath?: string
      }) => {
        try {
          const result = await browseWeb(url, {
            waitForSelector,
            timeout,
            waitForNetworkIdle,
            extractImages,
            extractLinks,
            extractMetadata,
            headless,
            useUserProfile,
            userDataDir,
            retries,
            retryDelay,
            useBrave,
            executablePath,
          })
          return result
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred while browsing web',
            url,
          }
        }
      },
    },
  },
]

// Function to update tool enabled status
export const updateToolEnabled = (toolName: string, enabled: boolean): boolean => {
  const tool = tools.find(t => t.name === toolName)
  if (tool) {
    tool.enabled = enabled
    return true
  }
  return false
}

// Function to get tool by name
export const getToolByName = (toolName: string): tools | undefined => {
  return tools.find(t => t.name === toolName)
}

export default tools
