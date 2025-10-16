// server/src/utils/ollama.ts
import { Message } from '../database/models'
import { modelService } from './modelService'
import tools from './tools'

interface OllamaMessage {
  role: string
  content: string
  tool_calls?: ToolCall[]
}

interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OllamaTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: any
  }
}

// Convert Zod schema to JSON Schema for Ollama
function zodToJsonSchema(): any {
  // This is a simplified conversion - for production use, consider using a library like zod-to-json-schema
  // For now, we'll provide basic schemas based on our known tool structure

  const commonSchemas: Record<string, any> = {
    directory: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The directory path to analyze (absolute or relative)' },
      },
      required: ['path'],
    },
    read_file: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to read (absolute or relative)' },
        maxBytes: {
          type: 'number',
          description: 'Optional safety limit on bytes to read; defaults to 204800 (200KB).',
        },
      },
      required: ['path'],
    },
    read_files: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of file paths to read (absolute or relative).',
        },
        baseDir: { type: 'string', description: 'Optional base directory used to compute the relative path header.' },
        maxBytes: {
          type: 'number',
          description: 'Optional per-file safety limit on bytes to read; defaults to 204800 (200KB).',
        },
      },
      required: ['paths'],
    },
    brave_search: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to execute' },
        count: { type: 'number', description: 'Number of results to return (default 10, max 20)' },
        offset: { type: 'number', description: 'Number of results to skip (default 0)' },
        safesearch: {
          type: 'string',
          enum: ['strict', 'moderate', 'off'],
          description: 'Safe search setting (default moderate)',
        },
        country: { type: 'string', description: 'Country code for localized results (e.g., "US", "GB")' },
        search_lang: { type: 'string', description: 'Language for search results (e.g., "en", "es")' },
        extra_snippets: { type: 'boolean', description: 'Include extra snippets in results' },
        summary: { type: 'boolean', description: 'Include AI-generated summary' },
      },
      required: ['query'],
    },
    browse_web: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to browse and extract content from' },
        waitForSelector: { type: 'string', description: 'Optional CSS selector to wait for before extracting content' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
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
          description: 'Use existing browser profile with your cookies and extensions (default false)',
        },
        userDataDir: {
          type: 'string',
          description: 'Path to browser user data directory. Required when useUserProfile=true.',
        },
        retries: { type: 'number', description: 'Number of retry attempts if browsing fails (default 2)' },
        retryDelay: { type: 'number', description: 'Delay between retries in milliseconds (default 1000)' },
        useBrave: { type: 'boolean', description: 'Use Brave browser instead of Chromium (default false)' },
        executablePath: { type: 'string', description: 'Custom path to browser executable (overrides useBrave)' },
      },
      required: ['url'],
    },
    create_file: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to create (absolute or relative)' },
        content: { type: 'string', description: 'Initial content to write to the file; defaults to empty' },
        directory: { type: 'string', description: 'Optional base directory; resolved when path is relative' },
        createParentDirs: {
          type: 'boolean',
          description: 'If true, create parent directories as needed (default true)',
        },
        overwrite: { type: 'boolean', description: 'If true, overwrite existing file (default false)' },
        executable: { type: 'boolean', description: 'If true, make the file executable on POSIX systems' },
      },
      required: ['path'],
    },
    delete_file: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to delete (absolute or relative)' },
        allowedExtensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of allowed file extensions (e.g., .txt, .json)',
        },
      },
      required: ['path'],
    },
    edit_file: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path to the file to edit' },
        operation: {
          type: 'string',
          enum: ['replace', 'replace_first', 'append'],
          description: 'Type of edit operation',
        },
        searchPattern: { type: 'string', description: 'The text pattern to find (required for replace operations)' },
        replacement: { type: 'string', description: 'The replacement text (required for replace operations)' },
        content: { type: 'string', description: 'Content to append (required for append operation)' },
        createBackup: { type: 'boolean', description: 'Whether to create a backup before editing (default false)' },
        encoding: { type: 'string', description: 'File encoding (default utf8)' },
      },
      required: ['path', 'operation'],
    },
    search_history: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query to run' },
        userId: { type: 'number', description: 'Optional user id to scope search' },
        projectId: { type: 'number', description: 'Optional project id to scope search' },
        conversationId: { type: 'number', description: 'Optional conversation id to scope search' },
        limit: { type: 'number', description: 'Optional result limit (default 10)' },
      },
      required: ['query'],
    },
  }

  return commonSchemas
}

// Convert our tools to Ollama-compatible format
function convertToolsToOllamaFormat(): OllamaTool[] {
  const schemas = zodToJsonSchema()

  return tools
    .filter(tool => tool.enabled)
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.tool.description,
        parameters: schemas[tool.name] || {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    }))
}

// Execute a tool call
async function executeTool(name: string, args: any): Promise<any> {
  const tool = tools.find(t => t.name === name && t.enabled)
  if (!tool) {
    throw new Error(`Tool "${name}" not found or not enabled`)
  }

  try {
    return await tool.tool.execute(args)
  } catch (error) {
    console.error(`Error executing tool "${name}":`, error)
    throw error
  }
}

// Handle tool calls and continue conversation
async function handleToolCalls(
  toolCalls: ToolCall[],
  onChunk: (chunk: string) => void,
  messages: Message[],
  model: string,
  systemPrompt?: string,
  useTools: boolean = true
): Promise<void> {
  // Execute all tool calls
  for (const toolCall of toolCalls) {
    try {
      // Handle arguments - they might be a string or already an object
      let args
      if (typeof toolCall.function.arguments === 'string') {
        args = JSON.parse(toolCall.function.arguments)
      } else {
        args = toolCall.function.arguments
      }
      const result = await executeTool(toolCall.function.name, args)

      // Add tool response to messages
      const toolMessage: Message = {
        role: 'tool',
        content: JSON.stringify(result),
        tool_call_id: toolCall.id,
      } as any

      // Add the assistant message with tool calls
      const assistantMessage: Message = {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall],
      } as any

      const updatedMessages = [...messages, assistantMessage, toolMessage]

      // Continue conversation with tool results
      await generateResponse(updatedMessages, onChunk, model, systemPrompt, useTools)
    } catch (error) {
      console.error(`Error handling tool call:`, error)
      onChunk(
        `\n\nError executing tool ${toolCall.function.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}

export async function generateResponse(
  messages: Message[],
  onChunk: (chunk: string) => void,
  model?: string,
  systemPrompt?: string,
  useTools: boolean = false
): Promise<void> {
  // Use provided model or get default
  const selectedModel = model || (await modelService.getDefaultModel())

  console.log('Using model:', selectedModel)

  const ollamaMessages: OllamaMessage[] = messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }))

  const requestBody: any = {
    model: selectedModel,
    messages: ollamaMessages,
    stream: true,
  }
  if (systemPrompt && systemPrompt.trim().length > 0) {
    requestBody.system = systemPrompt
  }

  // Add tools if enabled
  if (useTools) {
    const availableTools = convertToolsToOllamaFormat()
    if (availableTools.length > 0) {
      requestBody.tools = availableTools
    }
  }
  // console.log('Sending to ollama:', JSON.stringify(requestBody))
  //changed from localhost to 172.31.32.1 to run from wsl
  const response = await fetch('http://172.31.32.1:11434/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const decoder = new TextDecoder()
  let toolCalls: ToolCall[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(line => line.trim())

      for (const line of lines) {
        try {
          const data = JSON.parse(line)

          // Handle regular content
          if (data.message?.content) {
            onChunk(data.message.content)
          }

          // Handle tool calls
          if (data.message?.tool_calls) {
            toolCalls.push(...data.message.tool_calls)
          }

          // When streaming is done, execute any tool calls
          if (data.done && toolCalls.length > 0) {
            await handleToolCalls(toolCalls, onChunk, messages, selectedModel, systemPrompt, useTools)
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
