// src/features/chats/toolDefinitions.ts
// Tool definitions sent from client to server with each message request
// Tools execute locally via electron/localServer.ts, definitions are sent to AI API
// Supports both built-in tools and user-defined custom tools

import { loadToolEnabledStates } from '../../helpers/toolSettingsStorage'

export interface ToolDefinition {
  name: string
  enabled: boolean
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  // Custom tool metadata (set for user-defined tools)
  isCustom?: boolean
  sourcePath?: string
  version?: string
  author?: string
  // MCP tool metadata (set for MCP server tools)
  isMcp?: boolean
  mcpServerName?: string
  mcpToolName?: string // Original tool name before namespacing
}

// Built-in tool definitions (static)
const builtInToolDefinitions: ToolDefinition[] = [
  {
    name: 'directory',
    enabled: false,
    description:
      'Get the directory structure of a specified path. Useful for understanding project organization, finding files, or exploring codebases.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The directory path to analyze (absolute or relative)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'todo_list',
    enabled: true,
    description:
      'Manage Markdown todo lists stored as .md files. Names are auto-generated (e.g., "goku-sage-ember"). Four actions: create, list, read, edit.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'read', 'edit'],
          description:
            'Action to perform: "create" = create a new todo list (name auto-generated, returns the generated name); "list" = show 5 most recent todo lists; "read" = get contents of a specific list by name; "edit" = find and replace a line in an existing list.',
        },
        name: {
          type: 'string',
          description:
            'Todo list name (required for read, edit). Use the auto-generated name returned from "create" or shown in "list".',
        },
        content: {
          type: 'string',
          description:
            'Full Markdown content for "create" action. Use standard Markdown checkbox format: "- [ ] Task" for pending, "- [x] Task" for completed.',
        },
        search: {
          type: 'string',
          description:
            'For "edit" action: text to search for. Matches any line containing this text. Example: "Buy milk" will match line "- [ ] Buy milk".',
        },
        replacement: {
          type: 'string',
          description:
            'For "edit" action: the full replacement line. Example: to mark done, use "- [x] Buy milk". To update text, use "- [ ] Buy 2% milk".',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'read_file',
    enabled: true,
    description:
      'Read the contents of a text file (code, config, docs). Supports reading full files, single ranges, or multiple disjoint ranges. Returns file metadata (line endings, encoding, modification time) and optional content hash for validation. Range info is in metadata only - content returned matches exactly what is in the file. Rejects likely-binary files and truncates large files for safety.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to read (absolute or relative)' },
        maxBytes: {
          type: 'integer',
          minimum: 1,
          maximum: 5242880,
          description: 'Optional safety limit on bytes to read (1 to 5MB); defaults to 204800 (200KB)',
        },
        startLine: {
          type: 'integer',
          minimum: 1,
          description:
            'Optional 1-based line number to start reading from (inclusive). Use for single range reads. Ignored if ranges is provided.',
        },
        endLine: {
          type: 'integer',
          minimum: 1,
          description:
            'Optional 1-based line number to stop reading at (inclusive). Use with startLine for single range. Ignored if ranges is provided.',
        },
        ranges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              startLine: { type: 'integer', minimum: 1, description: '1-based start line (inclusive)' },
              endLine: { type: 'integer', minimum: 1, description: '1-based end line (inclusive)' },
            },
            required: ['startLine', 'endLine'],
          },
          description:
            'Array of line range objects to read multiple disjoint sections. Format: [{"startLine": 10, "endLine": 50}, {"startLine": 100, "endLine": 150}]. Range details are returned in metadata.ranges field. Takes precedence over startLine/endLine params.',
        },
        includeHash: {
          type: 'boolean',
          description: 'Calculate SHA256 content hash for validation with edit_file (default true)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_files',
    enabled: true,
    description:
      "Read multiple text/code/config files and return a single concatenated string, separated by each file's relative path header.",
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description:
            'Array of file paths to read. Example: ["src/index.ts", "src/utils.ts", "/absolute/path/file.js"]',
        },
        baseDir: {
          type: 'string',
          description: 'Optional base directory used to compute the relative path header.',
        },
        maxBytes: {
          type: 'integer',
          minimum: 1,
          maximum: 5242880,
          description: 'Optional per-file safety limit on bytes to read (1 to 5MB); defaults to 204800 (200KB)',
        },
        startLine: {
          type: 'integer',
          minimum: 1,
          description: 'Optional 1-based line number to start reading from (inclusive). Applies to all files.',
        },
        endLine: {
          type: 'integer',
          minimum: 1,
          description: 'Optional 1-based line number to stop reading at (inclusive). Applies to all files.',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'read_file_continuation',
    enabled: true,
    description:
      'Read the next chunk of a file after a specific line number. Designed for pagination to avoid duplicate reads. Use this when you previously read a file up to line N and want to continue reading from line N+1. Returns file metadata and content hash for validation.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to read (absolute or relative)' },
        afterLine: {
          type: 'integer',
          minimum: 0,
          description: '1-based line number to start reading after (exclusive). Use 0 to read from the beginning.',
        },
        numLines: {
          type: 'integer',
          minimum: 1,
          description: 'Number of lines to read after the specified line',
        },
        maxBytes: {
          type: 'integer',
          minimum: 1,
          maximum: 5242880,
          description: 'Optional safety limit on bytes to read (1 to 5MB); defaults to 204800 (200KB)',
        },
        includeHash: {
          type: 'boolean',
          description: 'Calculate SHA256 content hash for validation with edit_file (default true)',
        },
      },
      required: ['path', 'afterLine', 'numLines'],
    },
  },
  {
    name: 'create_file',
    enabled: true,
    description: 'Create a new text file with optional parent directory creation and overwrite support.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to create (absolute or relative).' },
        content: { type: 'string', description: 'Initial content to write to the file; defaults to empty.' },
        directory: { type: 'string', description: 'Optional base directory; resolved when path is relative.' },
        createParentDirs: {
          type: 'boolean',
          description: 'If true, create parent directories as needed (default true).',
        },
        overwrite: { type: 'boolean', description: 'If true, overwrite existing file (default false).' },
        executable: { type: 'boolean', description: 'If true, make the file executable on POSIX systems.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete_file',
    enabled: true,
    description: 'Delete a file at the specified path. Optionally restrict deletions to specific file extensions.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete (absolute or relative).' },
        allowedExtensions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Restrict deletions to specific extensions. Example: [".txt", ".json", ".log"]. Include the dot prefix.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    enabled: true,
    description:
      'Edit a file using search/replace or append. Operations: "replace" (all occurrences), "replace_first" (first match only), "append" (add to end). Uses layered matching: exact -> line-ending normalized -> whitespace normalized -> fuzzy. Escape sequences like \\n, \\t, \\r in search patterns are interpreted by default (disable with interpretEscapeSequences: false). Supports content validation using hash and metadata from read_file to prevent editing stale content.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path to the file to edit' },
        operation: {
          type: 'string',
          enum: ['replace', 'replace_first', 'append'],
          description: 'Type of edit operation',
        },
        searchPattern: {
          type: 'string',
          description:
            'REQUIRED for replace/replace_first operations. The exact text pattern to find in the file. Escape sequences like \\n (newline), \\t (tab), \\r (carriage return) are interpreted by default.',
        },
        replacement: {
          type: 'string',
          description:
            'REQUIRED for replace/replace_first operations. The text to replace the search pattern with. Supports escape sequences.',
        },
        content: {
          type: 'string',
          description: 'REQUIRED for append operation. The content to append to the end of the file.',
        },
        createBackup: { type: 'boolean', description: 'Whether to create a backup before editing (default false)' },
        encoding: { type: 'string', description: 'File encoding (default utf8)' },
        interpretEscapeSequences: {
          type: 'boolean',
          description:
            'Interpret escape sequences (\\n, \\t, \\r, etc.) in search and replacement strings (default true)',
        },
        validateContent: {
          type: 'boolean',
          description: 'Validate file has not changed since read using hash/metadata (default true)',
        },
        expectedHash: {
          type: 'string',
          description: 'Expected SHA256 content hash from read_file for validation. Prevents editing if file changed.',
        },
        expectedMetadata: {
          type: 'object',
          properties: {
            lineEnding: { type: 'string', enum: ['\n', '\r\n', 'mixed'] },
            hasBOM: { type: 'boolean' },
            encoding: { type: 'string' },
            lastModified: { type: 'string' },
            inode: { type: 'number' },
          },
          description: 'Expected file metadata from read_file for validation',
        },
      },
      required: ['path', 'operation'],
    },
  },
  {
    name: 'search_history',
    enabled: false,
    description: 'Search chat history across user, project, or conversation using the DB FTS utilities.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to run' },
        userId: {
          type: 'integer',
          description: 'User ID to scope search. Pass null or omit to search all users.',
        },
        projectId: {
          type: 'integer',
          description: 'Project ID to scope search. Pass null or omit to search all projects.',
        },
        conversationId: {
          type: 'integer',
          description: 'Conversation ID to scope search. Pass null or omit to search all conversations.',
        },
        limit: { type: 'integer', description: 'Optional result limit (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'brave_search',
    enabled: true,
    description:
      'Search the web using Brave Search API. Returns web search results with titles, URLs, and descriptions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to execute' },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: 20,
          description: 'Number of results to return (default 10, max 20)',
        },
        offset: { type: 'integer', minimum: 0, description: 'Number of results to skip (default 0)' },
        safesearch: {
          type: 'string',
          enum: ['strict', 'moderate', 'off'],
          description: 'Safe search setting (default moderate)',
        },
        country: { type: 'string', description: 'Country code for localized results (e.g., "US", "GB")' },
        search_lang: {
          type: 'string',
          description:
            'Language for search results using Brave-supported codes (e.g., "en", "es", "pt-br", "zh-hant"). Must be one of Brave Search API\'s allowed values.',
        },
        extra_snippets: { type: 'boolean', description: 'Include extra snippets in results' },
        summary: { type: 'boolean', description: 'Include AI-generated summary' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ripgrep',
    enabled: true,
    description:
      'Search files using ripgrep (rg). Supports regex, file filtering, context lines. Limits: max 500 matches, 5000 total chars, 500 chars/line. Use glob filter (e.g., "*.ts"), maxCount, or narrower patterns if limits exceeded.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex or literal string)' },
        searchPath: {
          type: 'string',
          description: 'Directory or file path to search (defaults to current directory ".")',
        },
        caseSensitive: { type: 'boolean', description: 'Case-sensitive search (default false for case-insensitive)' },
        lineNumbers: { type: 'boolean', description: 'Include line numbers in results (default true)' },
        count: {
          type: 'boolean',
          description: 'Count matches per file instead of showing line content (default false)',
        },
        filesWithMatches: { type: 'boolean', description: 'List only filenames with matches (default false)' },
        maxCount: { type: 'integer', minimum: 1, description: 'Maximum matches per file' },
        glob: { type: 'string', description: 'File pattern glob (e.g., "*.ts", "src/**/*.js")' },
        hidden: { type: 'boolean', description: 'Search hidden files and directories (default false)' },
        noIgnore: { type: 'boolean', description: 'Ignore .gitignore rules (default false)' },
        contextLines: {
          type: 'integer',
          minimum: 0,
          description: 'Show N lines of context before and after matches',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'bash',
    enabled: true,
    description:
      'Run bash commands inside the workspace. On Windows/Electron, paths are automatically converted to the default WSL distribution for compatibility.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command' },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Environment variables as key-value object. Example: {"NODE_ENV": "production", "DEBUG": "true"}',
        },
        timeoutMs: {
          type: 'integer',
          minimum: 100,
          maximum: 120000,
          description: 'Optional timeout in milliseconds (default 0 meaning no timeout)',
        },
        maxOutputChars: {
          type: 'integer',
          minimum: 100,
          maximum: 500000,
          description: 'Optional limit on total captured output characters (default 20000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'html_renderer',
    enabled: true,
    description:
      'Render and sanitize an HTML snippet. Returns sanitized HTML suitable for embedding as a content block. Always treat output as untrusted; client will re-sanitize before rendering.',
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'Raw HTML to sanitize and return' },
        allowUnsafe: {
          type: 'boolean',
          description:
            'If true, skip sanitization (not recommended). Defaults to false. Output is still re-sanitized client-side.',
        },
      },
      required: ['html'],
    },
  },
  {
    name: 'glob',
    enabled: true,
    description: 'Search for files using glob patterns with flexible matching and filtering options',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match files (e.g., "*.ts", "src/**/*.js")' },
        cwd: { type: 'string', description: 'Current working directory to search from' },
        ignore: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Patterns to exclude. String or array. Example: ["node_modules/**", "*.test.ts"] or "dist/**"',
        },
        dot: { type: 'boolean', description: 'Include dotfiles (default: false)' },
        absolute: { type: 'boolean', description: 'Return absolute paths (default: false)' },
        mark: { type: 'boolean', description: 'Add / suffix to directories (default: false)' },
        nosort: { type: 'boolean', description: 'Do not sort results (default: false)' },
        nocase: { type: 'boolean', description: 'Case-insensitive matching on Windows (default: false)' },
        nodir: { type: 'boolean', description: 'Do not match directories (default: false)' },
        follow: { type: 'boolean', description: 'Follow symbolic links (default: false)' },
        realpath: { type: 'boolean', description: 'Return resolved absolute paths (default: false)' },
        stat: { type: 'boolean', description: 'Call stat() on all results (default: false)' },
        withFileTypes: { type: 'boolean', description: 'Return file type objects instead of paths (default: false)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'browse_web',
    enabled: true,
    description:
      'Browse a web page and extract its content, including text, headings, links, images, and metadata. Uses Playwright to handle JavaScript-rendered content. Supports both headless and non-headless modes for bot detection avoidance. Use headless mode as default unless specified by user.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri', description: 'The URL to browse and extract content from' },
        waitForSelector: {
          type: 'string',
          description: 'Optional CSS selector to wait for before extracting content',
        },
        timeout: {
          type: 'integer',
          minimum: 5000,
          maximum: 60000,
          description: 'Timeout in milliseconds (default 30000)',
        },
        waitForNetworkIdle: {
          type: 'boolean',
          description: 'Wait for network to be idle before extracting (default true)',
        },
        extractImages: { type: 'boolean', description: 'Extract image information (default true)' },
        extractLinks: { type: 'boolean', description: 'Extract link information (default true)' },
        extractMetadata: { type: 'boolean', description: 'Extract page metadata (default true)' },
        headless: {
          type: 'boolean',
          description: 'Run browser in headless mode (default true). Set to false to avoid bot detection.',
        },
        useUserProfile: {
          type: 'boolean',
          description:
            'Use existing browser profile with your cookies and extensions (default false). Only works with headless=false.',
        },
        userDataDir: {
          type: 'string',
          description:
            'Browser profile path for useUserProfile=true. Linux: "~/.config/google-chrome", Windows: "%LOCALAPPDATA%\\Google\\Chrome\\User Data", macOS: "~/Library/Application Support/Google/Chrome"',
        },
        retries: {
          type: 'integer',
          minimum: 0,
          maximum: 5,
          description: 'Number of retry attempts if browsing fails (default 2)',
        },
        retryDelay: {
          type: 'integer',
          minimum: 100,
          maximum: 10000,
          description: 'Delay between retries in milliseconds (default 1000)',
        },
        useBrave: { type: 'boolean', description: 'Use Brave browser instead of Chromium (default false)' },
        executablePath: {
          type: 'string',
          description: 'Custom path to browser executable (overrides useBrave)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'custom_tool_manager',
    enabled: true,
    description:
      'Query and discover custom tools. Use "list" to see all available custom tools with brief descriptions, or "get" to retrieve full definitions for specific tools by name. Custom tools extend AI capabilities with user-defined functionality.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get'],
          description:
            'Action to perform: "list" = show all custom tools with brief descriptions; "get" = retrieve full definitions for specific tools',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          description:
            'For "get" action: array of tool names to retrieve full definitions for. Example: ["my_tool", "another_tool"]',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'skill_manager',
    enabled: true,
    description:
      'Discover and activate specialized skills that provide detailed instructions for specific tasks. Use "list" to see available skills, "activate" to load a skill\'s instructions, or "load_resource" to fetch additional files (scripts, references, assets) from a skill.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'activate', 'load_resource'],
          description:
            'Action to perform: "list" = show all enabled skills; "activate" = load skill instructions; "load_resource" = fetch a resource file from the skill',
        },
        name: {
          type: 'string',
          description: 'Skill name (required for activate and load_resource actions)',
        },
        resourcePath: {
          type: 'string',
          description:
            'Path to resource file within the skill (e.g., "references/FORMS.md"). Required for load_resource action.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'subagent',
    enabled: true,
    description:
      'Spawn an agentic sub-agent to perform complex tasks using tool calls. The subagent can use tools like read_file, ripgrep, browse_web etc. to accomplish tasks autonomously. Supports multi-turn execution with configurable tool access. Messages are persisted and can be reviewed. Use orchestratorMode=true to specify exact tools, or false to use pre-configured default tools.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The task prompt for the subagent. Be specific and provide all necessary context.',
        },
        model: {
          type: 'string',
          description:
            'Model to use for the subagent (e.g., "anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.0-flash"). Defaults to anthropic/claude-sonnet-4.',
        },
        systemPrompt: {
          type: 'string',
          description: 'Optional system prompt to set the subagent behavior/persona.',
        },
        maxTokens: {
          type: 'integer',
          minimum: 1,
          maximum: 16384,
          description: 'Maximum tokens for the response (default 4096, max 16384).',
        },
        temperature: {
          type: 'number',
          minimum: 0,
          maximum: 2,
          description: 'Sampling temperature (0-2, default 0.7). Lower = more focused, higher = more creative.',
        },
        maxTurns: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description:
            'Maximum tool call rounds (default 10). Each turn = one LLM call + tool executions. Set lower for simple tasks.',
        },
        orchestratorMode: {
          type: 'boolean',
          description:
            'If true, use tools specified in `tools` parameter. If false, use pre-configured subagent tool list from settings. Default: false.',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Tool names to enable for subagent (only used when orchestratorMode=true). Example: ["read_file", "bash", "ripgrep", "brave_search"]. The subagent tool itself is always excluded to prevent recursion.',
        },
        inheritAutoApprove: {
          type: 'boolean',
          description:
            'If true, inherit parent auto-approve setting for tool calls. If false, always require approval for subagent tool calls. Default: true.',
        },
      },
      required: ['prompt'],
    },
  },
]

// Helper to deep clone a tool definition (makes it mutable)
const cloneTool = (tool: ToolDefinition): ToolDefinition => ({
  ...tool,
  inputSchema: {
    ...tool.inputSchema,
    properties: { ...tool.inputSchema.properties },
    required: tool.inputSchema.required ? [...tool.inputSchema.required] : undefined,
  },
})

// Mutable array that holds merged tools (built-in + custom)
// Deep clone to ensure objects are mutable
// Apply persisted enabled states from localStorage on initialization
const initializeTools = (): ToolDefinition[] => {
  const tools = builtInToolDefinitions.map(cloneTool)
  const persistedStates = loadToolEnabledStates()
  for (const tool of tools) {
    if (persistedStates[tool.name] !== undefined) {
      tool.enabled = persistedStates[tool.name]
    }
  }
  return tools
}
let mergedToolDefinitions: ToolDefinition[] = initializeTools()

/**
 * Set custom tools from the local server.
 * Custom tools are merged with built-in tools.
 * Custom tools cannot override built-in tools with the same name.
 * Preserves user's enabled/disabled state from localStorage (persisted) and in-memory state.
 */
export const setCustomTools = (customTools: ToolDefinition[]): void => {
  // Load persisted states from localStorage (survives app restarts)
  const persistedStates = loadToolEnabledStates()

  // Also preserve current in-memory enabled state (for session changes)
  const currentEnabledState = new Map<string, boolean>()
  for (const tool of mergedToolDefinitions) {
    currentEnabledState.set(tool.name, tool.enabled)
  }

  // Filter out any custom tools that would override built-ins
  const builtInNames = new Set(builtInToolDefinitions.map(t => t.name))
  const safeCustomTools = customTools.filter(ct => {
    if (builtInNames.has(ct.name)) {
      console.warn(`[ToolDefinitions] Custom tool "${ct.name}" ignored: conflicts with built-in tool`)
      return false
    }
    return true
  })

  // Merge built-in (cloned) and custom tools (cloned for safety)
  mergedToolDefinitions = [...builtInToolDefinitions.map(cloneTool), ...safeCustomTools.map(cloneTool)]

  // Apply enabled state: localStorage takes priority, then in-memory state, then default
  for (const tool of mergedToolDefinitions) {
    if (persistedStates[tool.name] !== undefined) {
      // Use persisted state from localStorage (survives restarts)
      tool.enabled = persistedStates[tool.name]
    } else if (currentEnabledState.has(tool.name)) {
      // Fall back to in-memory state (session changes)
      tool.enabled = currentEnabledState.get(tool.name)!
    }
    // Otherwise keep the default from definition
  }
}

/**
 * Set MCP tools from connected MCP servers.
 * MCP tools are merged with built-in and custom tools.
 * MCP tools cannot override built-in or custom tools with the same name.
 * Preserves user's enabled/disabled state from localStorage and in-memory state.
 */
export const setMcpTools = (mcpTools: ToolDefinition[]): void => {
  // Load persisted states from localStorage
  const persistedStates = loadToolEnabledStates()

  // Preserve current in-memory enabled state
  const currentEnabledState = new Map<string, boolean>()
  for (const tool of mergedToolDefinitions) {
    currentEnabledState.set(tool.name, tool.enabled)
  }

  // Get existing non-MCP tools
  const nonMcpTools = mergedToolDefinitions.filter(t => !t.isMcp)

  // Filter out any MCP tools that would override existing tools
  const existingNames = new Set(nonMcpTools.map(t => t.name))
  const safeMcpTools = mcpTools.filter(mt => {
    if (existingNames.has(mt.name)) {
      console.warn(`[ToolDefinitions] MCP tool "${mt.name}" ignored: conflicts with existing tool`)
      return false
    }
    return true
  })

  // Mark all MCP tools
  const markedMcpTools = safeMcpTools.map(t => ({
    ...cloneTool(t),
    isMcp: true,
  }))

  // Merge: non-MCP tools + MCP tools
  mergedToolDefinitions = [...nonMcpTools, ...markedMcpTools]

  // Apply enabled state
  for (const tool of mergedToolDefinitions) {
    if (persistedStates[tool.name] !== undefined) {
      tool.enabled = persistedStates[tool.name]
    } else if (currentEnabledState.has(tool.name)) {
      tool.enabled = currentEnabledState.get(tool.name)!
    }
  }
}

/**
 * Clear all MCP tools (keep built-in and custom tools)
 * Preserves user's enabled/disabled state.
 */
export const clearMcpTools = (): void => {
  const persistedStates = loadToolEnabledStates()
  const currentEnabledState = new Map<string, boolean>()
  for (const tool of mergedToolDefinitions) {
    currentEnabledState.set(tool.name, tool.enabled)
  }

  mergedToolDefinitions = mergedToolDefinitions.filter(t => !t.isMcp)

  for (const tool of mergedToolDefinitions) {
    if (persistedStates[tool.name] !== undefined) {
      tool.enabled = persistedStates[tool.name]
    } else if (currentEnabledState.has(tool.name)) {
      tool.enabled = currentEnabledState.get(tool.name)!
    }
  }
}

/**
 * Get MCP tools only
 */
export const getMcpTools = (): ToolDefinition[] => {
  return mergedToolDefinitions.filter(t => t.isMcp)
}

/**
 * Clear all custom tools (reset to built-in only)
 * Preserves user's enabled/disabled state from localStorage and in-memory state.
 */
export const clearCustomTools = (): void => {
  // Load persisted states from localStorage
  const persistedStates = loadToolEnabledStates()

  // Also preserve current in-memory enabled state
  const currentEnabledState = new Map<string, boolean>()
  for (const tool of mergedToolDefinitions) {
    currentEnabledState.set(tool.name, tool.enabled)
  }

  mergedToolDefinitions = builtInToolDefinitions.map(cloneTool)

  // Apply enabled state: localStorage takes priority, then in-memory state
  for (const tool of mergedToolDefinitions) {
    if (persistedStates[tool.name] !== undefined) {
      tool.enabled = persistedStates[tool.name]
    } else if (currentEnabledState.has(tool.name)) {
      tool.enabled = currentEnabledState.get(tool.name)!
    }
  }
}

// Get all tool definitions (built-in + custom)
export const getAllTools = (): ToolDefinition[] => {
  return mergedToolDefinitions
}

// Get only enabled tools (built-in + custom)
export const getEnabledTools = (): ToolDefinition[] => {
  const enabled = mergedToolDefinitions.filter(t => t.enabled)
  const customCount = enabled.filter(t => t.isCustom).length
  if (customCount > 0) {
    enabled.filter(t => t.isCustom).map(t => t.name)
  }
  return enabled
}

// Get built-in tools only
export const getBuiltInTools = (): ToolDefinition[] => {
  return builtInToolDefinitions
}

// Get custom tools only
export const getCustomTools = (): ToolDefinition[] => {
  return mergedToolDefinitions.filter(t => t.isCustom)
}

/**
 * Get tools to send to AI API.
 * Returns enabled built-in tools and MCP tools (excludes custom tools).
 * Custom tools are accessed via the custom_tool_manager tool.
 * MCP tools are sent directly since they're already namespaced (mcp__serverName__toolName).
 */
export const getToolsForAI = (): ToolDefinition[] => {
  // Use mergedToolDefinitions (mutable) to get current enabled state
  // Include built-in and MCP tools, exclude custom tools (accessed via custom_tool_manager)
  const enabled = mergedToolDefinitions.filter(t => t.enabled && !t.isCustom)
  return enabled
}

// Get tool by name
export const getToolByName = (name: string): ToolDefinition | undefined => {
  return mergedToolDefinitions.find(t => t.name === name)
}

// Update tool enabled status (works for both built-in and custom tools)
// Only updates mergedToolDefinitions (the mutable working copy)
export const updateToolEnabled = (name: string, enabled: boolean): boolean => {
  const tool = mergedToolDefinitions.find(t => t.name === name)
  if (tool) {
    tool.enabled = enabled
    return true
  }
  return false
}

export default builtInToolDefinitions
