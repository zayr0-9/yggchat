import { z } from 'zod/v4'
// src/utils/tools/toolRegistry.ts
// import { z } from 'zod/v4'
import { braveSearch } from './core/braveSearch'
import { browseWeb } from './core/browseWeb'
import { createTextFile } from './core/createFile'
import { deleteFile, safeDeleteFile } from './core/deleteFile'
import { editFile } from './core/editFile'
import { extractDirectoryStructure } from './core/getDirectoryTree'
import { readTextFile } from './core/readFile'
import { readMultipleTextFiles } from './core/readFiles'
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
    enabled: true,
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
    enabled: true,
    tool: {
      description:
        'Read the contents of a text file (code, config, docs). Rejects likely-binary files and truncates large files for safety.',
      inputSchema: z.object({
        path: z.string().describe('The file path to read (absolute or relative)'),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(5 * 1024 * 1024)
          .optional()
          .describe('Optional safety limit on bytes to read; defaults to 204800 (200KB).'),
      }),
      execute: async ({ path, maxBytes }: { path: string; maxBytes?: number }) => {
        try {
          const res = await readTextFile(path, { maxBytes })
          return {
            success: true,
            path,
            absolutePath: res.absolutePath,
            sizeBytes: res.sizeBytes,
            truncated: res.truncated,
            content: res.content,
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
    enabled: true,
    tool: {
      description:
        "Read multiple text/code/config files and return a single concatenated string, separated by each file's relative path header.",
      inputSchema: z.object({
        paths: z.array(z.string()).nonempty().describe('Array of file paths to read (absolute or relative).'),
        baseDir: z.string().optional().describe('Optional base directory used to compute the relative path header.'),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(5 * 1024 * 1024)
          .optional()
          .describe('Optional per-file safety limit on bytes to read; defaults to 204800 (200KB).'),
      }),
      execute: async ({ paths, baseDir, maxBytes }: { paths: string[]; baseDir?: string; maxBytes?: number }) => {
        try {
          const res = await readMultipleTextFiles(paths, { baseDir, maxBytes })
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
        search_lang: z.string().optional().describe('Language for search results (e.g., "en", "es")'),
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
    name: 'browse_web',
    enabled: true,
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
        // Helper function to coerce string booleans to actual booleans
        const toBoolean = (value: any): boolean | undefined => {
          if (value === undefined || value === null) return undefined
          if (typeof value === 'boolean') return value
          if (typeof value === 'string') {
            const lower = value.toLowerCase()
            if (lower === 'true') return true
            if (lower === 'false') return false
          }
          return undefined
        }

        // Helper function to coerce string numbers to actual numbers
        const toNumber = (value: any): number | undefined => {
          if (value === undefined || value === null) return undefined
          if (typeof value === 'number') return value
          if (typeof value === 'string') {
            const parsed = parseInt(value, 10)
            if (!isNaN(parsed)) return parsed
          }
          return undefined
        }

        try {
          const result = await browseWeb(url, {
            waitForSelector,
            timeout: toNumber(timeout),
            waitForNetworkIdle: toBoolean(waitForNetworkIdle),
            extractImages: toBoolean(extractImages),
            extractLinks: toBoolean(extractLinks),
            extractMetadata: toBoolean(extractMetadata),
            headless: toBoolean(headless),
            useUserProfile: toBoolean(useUserProfile),
            userDataDir,
            retries: toNumber(retries),
            retryDelay: toNumber(retryDelay),
            useBrave: toBoolean(useBrave),
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
