# Custom Tools Development Guide

This guide explains how to build custom tools for Yggdrasil. All tools **must support headless operation** for LLM automation. UI is optional.

## Tool Modes

| Mode              | Files Required                             | Use Case                                   |
| ----------------- | ------------------------------------------ | ------------------------------------------ |
| **Headless**      | `definition.json` + `index.js`             | LLM automation, no user interaction needed |
| **Headless + UI** | `definition.json` + `index.js` + `ui.html` | Both LLM automation AND interactive UI     |

**Key Principle:** Every operation available in the UI must also be callable headlessly by the LLM.

## Execution Modes

| Parameter  | Value             | Behavior                                                           |
| ---------- | ----------------- | ------------------------------------------------------------------ |
| `parallel` | `false` (default) | Uses shared server-side state. Multiple calls share context.       |
| `parallel` | `true`            | Fresh isolated state. Each call is independent, no shared context. |

**When to use `parallel: true`:**

- Running multiple independent operations concurrently
- Batch processing where each item should be isolated
- Avoiding state pollution between calls
- LLM running multiple tool instances simultaneously

---

## File Structure

```
custom-tools/
└── my_tool/
    ├── definition.json   ← Tool metadata (name, description, parameters)
    ├── index.js          ← Core logic (REQUIRED - handles both modes)
    └── ui.html           ← Optional UI for interactive use
```

---

## File 1: definition.json

Defines the tool's name, description, and parameters. The schema must include a `mode` parameter.

```json
{
  "name": "my_tool",
  "description": "Description for the LLM. Explain what operations are available in headless mode.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["headless", "ui"],
        "description": "Operation mode: 'headless' for direct execution, 'ui' for interactive interface",
        "default": "headless"
      },
      "parallel": {
        "type": "boolean",
        "description": "If true, run with fresh isolated state. If false (default), use shared server-side state.",
        "default": false
      },
      "action": {
        "type": "string",
        "enum": ["search", "convert", "process"],
        "description": "The operation to perform (headless mode)"
      },
      "input": {
        "type": "string",
        "description": "Input file path or data"
      },
      "output": {
        "type": "string",
        "description": "Output file path"
      },
      "options": {
        "type": "object",
        "description": "Additional options for the operation"
      }
    },
    "required": []
  }
}
```

**Rules:**

- `name` must be lowercase with underscores only (e.g., `my_tool`, not `MyTool`)
- Use `inputSchema` (camelCase), NOT `input_schema`
- Always include `mode` parameter with `headless` as default
- Always include `parallel` parameter with `false` as default
- Document all headless actions clearly in the description

---

## File 2: index.js (Core Logic)

This file handles **both** headless execution and UI rendering. Headless is the primary mode.

### State Management

Tools can maintain server-side state between calls. The `parallel` parameter controls state isolation:

- `parallel: false` (default) - Uses shared state stored in `sharedState`
- `parallel: true` - Creates fresh state for each call, stored in `instanceStates` with unique ID

```javascript
// SHARED STATE: Persists across calls when parallel=false
let sharedState = {
  history: [],
  cache: {},
  lastResult: null,
}

// INSTANCE STATES: For parallel=true, keyed by unique instance ID
const instanceStates = new Map()

function getState(args) {
  if (args.parallel) {
    // Create fresh isolated state for this instance
    const instanceId = args._instanceId || Date.now().toString()
    if (!instanceStates.has(instanceId)) {
      instanceStates.set(instanceId, {
        history: [],
        cache: {},
        lastResult: null,
      })
    }
    return { state: instanceStates.get(instanceId), instanceId }
  }
  // Use shared state
  return { state: sharedState, instanceId: 'shared' }
}

function cleanupInstance(instanceId) {
  if (instanceId !== 'shared') {
    instanceStates.delete(instanceId)
  }
}
```

### Basic Template

```javascript
const fs = require('fs')
const path = require('path')
const { execSync, exec } = require('child_process')

// ============================================
// STATE MANAGEMENT
// ============================================

// Shared state: persists across calls when parallel=false
let sharedState = {
  history: [],
  cache: {},
  settings: {},
}

// Instance states: for parallel=true, each call gets isolated state
const instanceStates = new Map()

function getState(args) {
  if (args.parallel) {
    const instanceId = args._instanceId || `inst_${Date.now()}_${Math.random().toString(36).slice(2)}`
    if (!instanceStates.has(instanceId)) {
      instanceStates.set(instanceId, {
        history: [],
        cache: {},
        settings: {},
      })
    }
    return { state: instanceStates.get(instanceId), instanceId }
  }
  return { state: sharedState, instanceId: 'shared' }
}

function cleanupInstance(instanceId) {
  if (instanceId !== 'shared') {
    instanceStates.delete(instanceId)
  }
}

// ============================================
// CORE OPERATIONS (used by both headless and UI)
// ============================================

async function searchFiles(query, directory = '.', state) {
  const result = execSync(`dir /s /b "*${query}*"`, {
    cwd: directory,
    encoding: 'utf-8',
    timeout: 30000,
  })
  const files = result
    .trim()
    .split('\n')
    .filter(f => f.trim())

  // Store in state history
  state.history.push({ action: 'search', query, count: files.length, timestamp: Date.now() })
  state.lastResult = files

  return files
}

async function convertFile(inputPath, outputPath, options = {}, state) {
  const cmd = `ffmpeg -i "${inputPath}" ${options.flags || ''} "${outputPath}"`
  execSync(cmd, { encoding: 'utf-8' })

  // Store in state
  state.history.push({ action: 'convert', input: inputPath, output: outputPath, timestamp: Date.now() })

  return { success: true, outputPath }
}

async function getHistory(state) {
  return state.history
}

async function clearHistory(state) {
  state.history = []
  return { success: true, message: 'History cleared' }
}

// ============================================
// ACTION DISPATCHER (maps action names to functions)
// ============================================

const ACTIONS = {
  search: async (args, state) => {
    const files = await searchFiles(args.query, args.directory, state)
    return { success: true, files, count: files.length }
  },

  convert: async (args, state) => {
    return await convertFile(args.input, args.output, args.options, state)
  },

  history: async (args, state) => {
    return { success: true, history: await getHistory(state) }
  },

  clear_history: async (args, state) => {
    return await clearHistory(state)
  },

  cleanup: async (args, state, instanceId) => {
    cleanupInstance(instanceId)
    return { success: true, message: 'Instance state cleaned up' }
  },
}

// ============================================
// MAIN EXECUTE FUNCTION
// ============================================

module.exports = {
  execute: async function (args) {
    const mode = args.mode || 'headless'
    const { state, instanceId } = getState(args)

    // ─────────────────────────────────────────
    // HEADLESS MODE: Execute action directly
    // ─────────────────────────────────────────
    if (mode === 'headless') {
      const action = args.action

      if (!action) {
        return {
          type: 'application/json',
          content: JSON.stringify(
            {
              success: false,
              error: 'Missing required parameter: action',
              availableActions: Object.keys(ACTIONS),
              instanceId,
              parallel: args.parallel || false,
            },
            null,
            2
          ),
        }
      }

      if (!ACTIONS[action]) {
        return {
          type: 'application/json',
          content: JSON.stringify(
            {
              success: false,
              error: `Unknown action: ${action}`,
              availableActions: Object.keys(ACTIONS),
            },
            null,
            2
          ),
        }
      }

      try {
        const result = await ACTIONS[action](args, state, instanceId)
        return {
          type: 'application/json',
          content: JSON.stringify({ ...result, instanceId }, null, 2),
        }
      } catch (err) {
        return {
          type: 'application/json',
          content: JSON.stringify(
            {
              success: false,
              error: err.message,
              instanceId,
            },
            null,
            2
          ),
        }
      }
    }

    // ─────────────────────────────────────────
    // UI MODE: Return HTML interface
    // ─────────────────────────────────────────
    const htmlPath = path.join(__dirname, 'ui.html')

    if (!fs.existsSync(htmlPath)) {
      return {
        type: 'application/json',
        content: JSON.stringify(
          {
            success: false,
            error: 'UI mode not available for this tool. Use mode: "headless"',
          },
          null,
          2
        ),
      }
    }

    let html = fs.readFileSync(htmlPath, 'utf-8')
    const config = { ...args, toolDir: __dirname, instanceId }
    html = html.replace('{{CONFIG}}', JSON.stringify(config))

    return { type: 'text/html', content: html }
  },
}
```

### Headless-Only Template (No UI)

For tools that don't need a UI:

```javascript
const { execSync } = require('child_process')

// ============================================
// STATE MANAGEMENT
// ============================================

let sharedState = { processedFiles: [], stats: { total: 0, success: 0, failed: 0 } }
const instanceStates = new Map()

function getState(args) {
  if (args.parallel) {
    const instanceId = args._instanceId || `inst_${Date.now()}_${Math.random().toString(36).slice(2)}`
    if (!instanceStates.has(instanceId)) {
      instanceStates.set(instanceId, { processedFiles: [], stats: { total: 0, success: 0, failed: 0 } })
    }
    return { state: instanceStates.get(instanceId), instanceId }
  }
  return { state: sharedState, instanceId: 'shared' }
}

function cleanupInstance(instanceId) {
  if (instanceId !== 'shared') instanceStates.delete(instanceId)
}

// ============================================
// ACTIONS
// ============================================

const ACTIONS = {
  compress: async (args, state) => {
    const { input, output, quality = 23 } = args
    if (!input || !output) throw new Error('Missing required: input, output')

    state.stats.total++
    try {
      execSync(`ffmpeg -i "${input}" -crf ${quality} "${output}"`, { encoding: 'utf-8' })
      state.stats.success++
      state.processedFiles.push({ input, output, status: 'success' })
      return { success: true, input, output, quality }
    } catch (err) {
      state.stats.failed++
      state.processedFiles.push({ input, output, status: 'failed', error: err.message })
      throw err
    }
  },

  info: async (args, state) => {
    const { input } = args
    if (!input) throw new Error('Missing required: input')
    const result = execSync(`ffprobe -v quiet -print_format json -show_format "${input}"`, {
      encoding: 'utf-8',
    })
    return { success: true, info: JSON.parse(result) }
  },

  stats: async (args, state) => {
    return { success: true, stats: state.stats, processedFiles: state.processedFiles }
  },

  cleanup: async (args, state, instanceId) => {
    cleanupInstance(instanceId)
    return { success: true, message: 'Instance cleaned up' }
  },
}

// ============================================
// MAIN EXECUTE
// ============================================

module.exports = {
  execute: async function (args) {
    const { state, instanceId } = getState(args)
    const action = args.action

    if (!action || !ACTIONS[action]) {
      return {
        type: 'application/json',
        content: JSON.stringify(
          {
            success: false,
            error: action ? `Unknown action: ${action}` : 'Missing action parameter',
            availableActions: Object.keys(ACTIONS),
            instanceId,
            parallel: args.parallel || false,
            usage: {
              compress: { input: 'path', output: 'path', quality: 'number (optional, default 23)' },
              info: { input: 'path' },
              stats: {},
              cleanup: {},
            },
          },
          null,
          2
        ),
      }
    }

    try {
      const result = await ACTIONS[action](args, state, instanceId)
      return { type: 'application/json', content: JSON.stringify({ ...result, instanceId }, null, 2) }
    } catch (err) {
      return {
        type: 'application/json',
        content: JSON.stringify({ success: false, error: err.message, instanceId }, null, 2),
      }
    }
  },
}
```

---

## File 3: ui.html (Optional)

Only needed if you want an interactive interface. The UI should call the same operations defined in `index.js`.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Tool</title>
    <script>
      const CONFIG = {{CONFIG}};
    </script>

    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #1a1a2e;
        color: #e2e8f0;
        padding: 24px;
      }
      .btn {
        background: #6366f1;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
      }
      .btn:hover {
        background: #4f46e5;
      }
      .input {
        padding: 12px 16px;
        font-size: 16px;
        background: #1a1a2e;
        border: 2px solid #2d2d4a;
        border-radius: 8px;
        color: #e2e8f0;
        width: 100%;
      }
      .input:focus {
        outline: none;
        border-color: #6366f1;
      }
      .output {
        background: #0f0f1a;
        border-radius: 8px;
        padding: 16px;
        margin-top: 16px;
        font-family: monospace;
        white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <h1>My Tool</h1>

    <div style="margin: 20px 0;">
      <input type="text" id="queryInput" class="input" placeholder="Enter query..." />
    </div>

    <button class="btn" onclick="doSearch()">Search</button>
    <button class="btn" onclick="selectFile()">Select File</button>

    <div class="output" id="output">Ready.</div>

    <script>
      // PostMessage bridge for Electron features
      let reqId = 0
      const pending = new Map()

      function send(type, options) {
        return new Promise((resolve, reject) => {
          const id = 'r' + ++reqId + '_' + Date.now()
          pending.set(id, { resolve, reject })
          window.parent.postMessage({ type, requestId: id, options }, '*')
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id)
              reject(new Error('Request timeout'))
            }
          }, 60000)
        })
      }

      window.addEventListener('message', e => {
        if (e.data && e.data.requestId && pending.has(e.data.requestId)) {
          pending.get(e.data.requestId).resolve(e.data)
          pending.delete(e.data.requestId)
        }
      })

      // UI actions - these mirror the headless operations
      async function doSearch() {
        const query = document.getElementById('queryInput').value
        document.getElementById('output').textContent = 'Searching...'

        try {
          const result = await send('SHELL_EXEC', {
            command: `dir /s /b "*${query}*"`,
            cwd: 'C:\\',
            timeout: 30000,
          })
          document.getElementById('output').textContent = result.success ? result.stdout : 'Error: ' + result.error
        } catch (err) {
          document.getElementById('output').textContent = 'Error: ' + err.message
        }
      }

      async function selectFile() {
        const result = await send('DIALOG_OPEN_FILE', {
          title: 'Select File',
          properties: ['openFile'],
        })
        if (result.success && result.filePaths.length > 0) {
          document.getElementById('output').textContent = 'Selected: ' + result.filePaths[0]
        }
      }
    </script>
  </body>
</html>
```

---

## PostMessage Bridge API (UI Only)

When running in UI mode, use these APIs to access Electron features:

### File Open Dialog

```javascript
const result = await send('DIALOG_OPEN_FILE', {
  title: 'Select File',
  filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi'] }],
  properties: ['openFile'], // or ['openDirectory'], ['multiSelections']
})
if (result.success) console.log(result.filePaths)
```

### File Save Dialog

```javascript
const result = await send('DIALOG_SAVE_FILE', {
  title: 'Save As',
  defaultPath: 'output.txt',
  filters: [{ name: 'Text', extensions: ['txt'] }],
})
if (result.success) console.log(result.filePath)
```

### Read File

```javascript
const result = await send('FS_READ_FILE', {
  filePath: '/path/to/file.txt',
  encoding: 'utf-8',
})
if (result.success) console.log(result.content)
```

### Stream Read File (Chunked)

```javascript
const result = await send('FS_READ_FILE_STREAM', {
  filePath: '/path/to/large.bin',
  // Optional: emit strings instead of Uint8Array chunks.
  encoding: 'base64',
  // Optional: tune chunk size in bytes.
  highWaterMark: 1024 * 1024,
})

if (result.success) {
  const { streamId, total } = result
  console.log('total bytes:', total)
}

window.addEventListener('message', e => {
  switch (e.data?.type) {
    case 'FS_READ_FILE_STREAM_CHUNK':
      console.log('chunk', e.data.streamId, e.data.chunk)
      break
    case 'FS_READ_FILE_STREAM_PROGRESS':
      console.log('progress', e.data.loaded, '/', e.data.total)
      break
    case 'FS_READ_FILE_STREAM_END':
      console.log('done', e.data.streamId)
      break
    case 'FS_READ_FILE_STREAM_ERROR':
      console.error('stream error', e.data.error)
      break
    case 'FS_READ_FILE_STREAM_ABORTED':
      console.warn('stream aborted', e.data.streamId)
      break
  }
})
```

### File Stat (Size)

```javascript
const result = await send('FS_STAT', {
  filePath: '/path/to/file.txt',
})
if (result.success) console.log(result.size)
```

### Abort Stream

```javascript
const result = await send('FS_ABORT', {
  streamId: 'stream_...',
})
```

### Write File

```javascript
const result = await send('FS_WRITE_FILE', {
  filePath: '/path/to/output.txt',
  content: 'Hello World',
  encoding: 'utf-8',
})
```

### Create Directory

```javascript
const result = await send('FS_MKDIR', {
  dirPath: '/path/to/new/directory',
})
```

### Execute Shell Command

```javascript
const result = await send('SHELL_EXEC', {
  command: 'ffmpeg -i "input.mp4" -crf 23 "output.mp4"',
  cwd: '/working/directory',
  timeout: 300000,
})
if (result.success) {
  console.log('stdout:', result.stdout)
  console.log('stderr:', result.stderr)
}
```

### LLM Generation (Ephemeral)

Make one-off LLM generation requests directly from your tool UI. This is useful for AI-powered features within your tools without creating chat messages.

```javascript
// Request generation
const result = await send('REQUEST_GENERATION', {
  prompt: 'Summarize this code:\n\n' + codeContent,
  model: 'anthropic/claude-sonnet-4', // Optional, defaults to claude-sonnet-4
  maxTokens: 4096, // Optional, defaults to 4096
  temperature: 0.7, // Optional, defaults to 0.7
  systemPrompt: 'You are a helpful code assistant.', // Optional
})

if (result.success) {
  console.log('Generated text:', result.text)
}
```

#### Streaming Response

The generation streams tokens as they arrive. Listen for chunk events:

```javascript
let fullText = ''

// Listen for streaming chunks
window.addEventListener('message', e => {
  if (e.data?.type === 'REQUEST_GENERATION_CHUNK' && e.data.requestId === myRequestId) {
    // e.data.chunk - the new text chunk
    // e.data.text - accumulated full text so far
    fullText = e.data.text
    updateUI(fullText)
  }
})

// Initiate the request
const myRequestId = 'gen_' + Date.now()
window.parent.postMessage(
  {
    type: 'REQUEST_GENERATION',
    requestId: myRequestId,
    options: {
      prompt: 'Explain quantum computing',
      model: 'anthropic/claude-sonnet-4',
    },
  },
  '*'
)

// The final response will come as REQUEST_GENERATION_RESPONSE
window.addEventListener('message', e => {
  if (e.data?.type === 'REQUEST_GENERATION_RESPONSE' && e.data.requestId === myRequestId) {
    if (e.data.success) {
      console.log('Final text:', e.data.text)
    } else {
      console.error('Error:', e.data.error)
    }
  }
})
```

#### Complete Example: AI Code Analyzer

```html
<button onclick="analyzeCode()">Analyze Code</button>
<div id="analysis"></div>

<script>
  async function analyzeCode() {
    const code = document.getElementById('codeInput').value
    const analysisDiv = document.getElementById('analysis')
    analysisDiv.textContent = 'Analyzing...'

    let reqId = 'analysis_' + Date.now()

    // Listen for streaming updates
    const handler = e => {
      if (e.data?.type === 'REQUEST_GENERATION_CHUNK' && e.data.requestId === reqId) {
        analysisDiv.textContent = e.data.text
      }
      if (e.data?.type === 'REQUEST_GENERATION_RESPONSE' && e.data.requestId === reqId) {
        window.removeEventListener('message', handler)
        if (!e.data.success) {
          analysisDiv.textContent = 'Error: ' + e.data.error
        }
      }
    }
    window.addEventListener('message', handler)

    // Send generation request
    window.parent.postMessage(
      {
        type: 'REQUEST_GENERATION',
        requestId: reqId,
        options: {
          prompt: `Analyze this code for potential issues, suggest improvements, and explain what it does:\n\n\`\`\`\n${code}\n\`\`\``,
          systemPrompt: 'You are a senior software engineer. Be concise and practical.',
          temperature: 0.3,
        },
      },
      '*'
    )
  }
</script>
```

#### Available Models

You can specify any model available through OpenRouter, or use direct provider models:

- `anthropic/claude-sonnet-4` (default)
- `anthropic/claude-3-5-sonnet`
- `openai/gpt-4o`
- `google/gemini-2.0-flash`
- Or any OpenRouter model ID

**Note:** Ephemeral generation uses your account's credits and respects rate limits.

---

## Complete Example: File Converter Tool

### definition.json

```json
{
  "name": "file_converter",
  "description": "Convert files between formats. Actions: 'convert' (convert file), 'info' (get file info), 'list_formats' (show supported formats), 'stats' (get processing stats), 'cleanup' (cleanup parallel instance). Use parallel:true for batch processing. Example: {action: 'convert', input: 'video.mp4', output: 'video.webm', parallel: true}",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["headless", "ui"],
        "default": "headless",
        "description": "headless for LLM automation, ui for interactive interface"
      },
      "parallel": {
        "type": "boolean",
        "default": false,
        "description": "If true, use isolated state for this call. If false, use shared state."
      },
      "_instanceId": {
        "type": "string",
        "description": "Optional instance ID for parallel mode. Allows multiple calls to share the same isolated state."
      },
      "action": {
        "type": "string",
        "enum": ["convert", "info", "list_formats", "stats", "cleanup"],
        "description": "Operation to perform"
      },
      "input": {
        "type": "string",
        "description": "Input file path"
      },
      "output": {
        "type": "string",
        "description": "Output file path"
      },
      "options": {
        "type": "object",
        "properties": {
          "quality": {
            "type": "string",
            "enum": ["low", "medium", "high"],
            "default": "medium"
          },
          "overwrite": {
            "type": "boolean",
            "default": false
          }
        }
      }
    },
    "required": []
  }
}
```

### index.js

```javascript
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ============================================
// STATE MANAGEMENT
// ============================================

// Shared state: used when parallel=false (default)
let sharedState = {
  history: [],
  stats: { total: 0, success: 0, failed: 0 },
}

// Instance states: used when parallel=true
const instanceStates = new Map()

function getState(args) {
  if (args.parallel) {
    const instanceId = args._instanceId || `inst_${Date.now()}_${Math.random().toString(36).slice(2)}`
    if (!instanceStates.has(instanceId)) {
      instanceStates.set(instanceId, {
        history: [],
        stats: { total: 0, success: 0, failed: 0 },
      })
    }
    return { state: instanceStates.get(instanceId), instanceId }
  }
  return { state: sharedState, instanceId: 'shared' }
}

function cleanupInstance(instanceId) {
  if (instanceId !== 'shared') {
    instanceStates.delete(instanceId)
  }
}

// ============================================
// CONFIGURATION
// ============================================

const QUALITY_MAP = {
  low: { crf: 28, preset: 'faster' },
  medium: { crf: 23, preset: 'medium' },
  high: { crf: 18, preset: 'slow' },
}

const FORMATS = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'gif', 'mp3', 'wav', 'flac']

// ============================================
// CORE OPERATIONS
// ============================================

async function convertFile(input, output, options = {}, state) {
  if (!input) throw new Error('Missing required: input')
  if (!output) throw new Error('Missing required: output')
  if (!fs.existsSync(input)) throw new Error(`Input file not found: ${input}`)

  const quality = QUALITY_MAP[options.quality] || QUALITY_MAP.medium
  const overwrite = options.overwrite ? '-y' : '-n'
  const cmd = `ffmpeg ${overwrite} -i "${input}" -crf ${quality.crf} -preset ${quality.preset} "${output}"`

  state.stats.total++

  try {
    execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' })
    const stats = fs.statSync(output)
    state.stats.success++
    state.history.push({ action: 'convert', input, output, status: 'success', timestamp: Date.now() })

    return {
      success: true,
      input,
      output,
      size: stats.size,
      quality: options.quality || 'medium',
    }
  } catch (err) {
    state.stats.failed++
    state.history.push({
      action: 'convert',
      input,
      output,
      status: 'failed',
      error: err.message,
      timestamp: Date.now(),
    })
    throw new Error(`Conversion failed: ${err.stderr || err.message}`)
  }
}

async function getFileInfo(input, state) {
  if (!input) throw new Error('Missing required: input')
  if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`)

  const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${input}"`
  const result = execSync(cmd, { encoding: 'utf-8' })
  state.history.push({ action: 'info', input, timestamp: Date.now() })

  return { success: true, info: JSON.parse(result) }
}

async function listFormats() {
  return { success: true, formats: FORMATS }
}

async function getStats(state) {
  return { success: true, stats: state.stats, history: state.history }
}

// ============================================
// ACTION DISPATCHER
// ============================================

const ACTIONS = {
  convert: async (args, state) => convertFile(args.input, args.output, args.options, state),
  info: async (args, state) => getFileInfo(args.input, state),
  list_formats: async () => listFormats(),
  stats: async (args, state) => getStats(state),
  cleanup: async (args, state, instanceId) => {
    cleanupInstance(instanceId)
    return { success: true, message: 'Instance state cleaned up' }
  },
}

// ============================================
// MAIN EXECUTE
// ============================================

module.exports = {
  execute: async function (args) {
    const mode = args.mode || 'headless'
    const { state, instanceId } = getState(args)

    // HEADLESS MODE
    if (mode === 'headless') {
      const action = args.action

      if (!action || !ACTIONS[action]) {
        return {
          type: 'application/json',
          content: JSON.stringify(
            {
              success: false,
              error: action ? `Unknown action: ${action}` : 'Missing action parameter',
              availableActions: Object.keys(ACTIONS),
              instanceId,
              parallel: args.parallel || false,
              usage: {
                convert: {
                  input: 'path',
                  output: 'path',
                  options: { quality: 'low|medium|high', overwrite: 'boolean' },
                },
                info: { input: 'path' },
                list_formats: {},
                stats: {},
                cleanup: {},
              },
            },
            null,
            2
          ),
        }
      }

      try {
        const result = await ACTIONS[action](args, state, instanceId)
        return { type: 'application/json', content: JSON.stringify({ ...result, instanceId }, null, 2) }
      } catch (err) {
        return {
          type: 'application/json',
          content: JSON.stringify({ success: false, error: err.message, instanceId }, null, 2),
        }
      }
    }

    // UI MODE
    const htmlPath = path.join(__dirname, 'ui.html')
    if (!fs.existsSync(htmlPath)) {
      return {
        type: 'application/json',
        content: JSON.stringify({ success: false, error: 'UI not available' }, null, 2),
      }
    }

    let html = fs.readFileSync(htmlPath, 'utf-8')
    html = html.replace('{{CONFIG}}', JSON.stringify({ ...args, toolDir: __dirname, instanceId }))
    return { type: 'text/html', content: html }
  },
}
```

### ui.html

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>File Converter</title>
    <script>
      const CONFIG = {{CONFIG}};
    </script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #0f0f1a;
        color: #e2e8f0;
        padding: 24px;
        min-height: 100vh;
      }
      h1 {
        font-size: 24px;
        margin-bottom: 24px;
        color: #6366f1;
      }
      .row {
        display: flex;
        gap: 12px;
        margin-bottom: 16px;
        align-items: center;
      }
      .label {
        width: 80px;
        font-weight: 500;
      }
      .input {
        flex: 1;
        padding: 12px 16px;
        font-size: 14px;
        background: #1a1a2e;
        border: 2px solid #2d2d4a;
        border-radius: 8px;
        color: #e2e8f0;
      }
      .input:focus {
        outline: none;
        border-color: #6366f1;
      }
      .btn {
        padding: 12px 24px;
        background: #6366f1;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
      }
      .btn:hover {
        background: #4f46e5;
      }
      .btn-secondary {
        background: #2d2d4a;
      }
      .btn-secondary:hover {
        background: #3d3d5a;
      }
      select {
        padding: 12px 16px;
        background: #1a1a2e;
        border: 2px solid #2d2d4a;
        border-radius: 8px;
        color: #e2e8f0;
        font-size: 14px;
      }
      .output {
        background: #1a1a2e;
        border-radius: 12px;
        padding: 16px;
        margin-top: 24px;
        font-family: monospace;
        font-size: 13px;
        white-space: pre-wrap;
        max-height: 300px;
        overflow-y: auto;
      }
      .success {
        color: #10b981;
      }
      .error {
        color: #ef4444;
      }
    </style>
  </head>
  <body>
    <h1>File Converter</h1>

    <div class="row">
      <span class="label">Input:</span>
      <input type="text" id="inputPath" class="input" placeholder="Input file path..." readonly />
      <button class="btn btn-secondary" onclick="selectInput()">Browse</button>
    </div>

    <div class="row">
      <span class="label">Output:</span>
      <input type="text" id="outputPath" class="input" placeholder="Output file path..." readonly />
      <button class="btn btn-secondary" onclick="selectOutput()">Browse</button>
    </div>

    <div class="row">
      <span class="label">Quality:</span>
      <select id="quality">
        <option value="low">Low (fast, larger file)</option>
        <option value="medium" selected>Medium (balanced)</option>
        <option value="high">High (slow, smaller file)</option>
      </select>
    </div>

    <div class="row" style="margin-top: 24px;">
      <button class="btn" onclick="convert()">Convert</button>
      <button class="btn btn-secondary" onclick="getInfo()">Get Info</button>
    </div>

    <div class="output" id="output">Select input and output files to begin.</div>

    <script>
      let reqId = 0
      const pending = new Map()

      function send(type, options) {
        return new Promise((resolve, reject) => {
          const id = 'r' + ++reqId + '_' + Date.now()
          pending.set(id, { resolve, reject })
          window.parent.postMessage({ type, requestId: id, options }, '*')
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id)
              reject(new Error('Request timeout'))
            }
          }, 300000) // 5 min timeout for conversions
        })
      }

      window.addEventListener('message', e => {
        if (e.data?.requestId && pending.has(e.data.requestId)) {
          pending.get(e.data.requestId).resolve(e.data)
          pending.delete(e.data.requestId)
        }
      })

      async function selectInput() {
        const result = await send('DIALOG_OPEN_FILE', {
          title: 'Select Input File',
          filters: [
            { name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'mp3', 'wav', 'flac'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        })
        if (result.success && result.filePaths[0]) {
          document.getElementById('inputPath').value = result.filePaths[0]
        }
      }

      async function selectOutput() {
        const result = await send('DIALOG_SAVE_FILE', {
          title: 'Save Output As',
          filters: [
            { name: 'MP4', extensions: ['mp4'] },
            { name: 'WebM', extensions: ['webm'] },
            { name: 'MKV', extensions: ['mkv'] },
            { name: 'MP3', extensions: ['mp3'] },
          ],
        })
        if (result.success && result.filePath) {
          document.getElementById('outputPath').value = result.filePath
        }
      }

      async function convert() {
        const input = document.getElementById('inputPath').value
        const output = document.getElementById('outputPath').value
        const quality = document.getElementById('quality').value

        if (!input || !output) {
          showOutput('Please select input and output files.', 'error')
          return
        }

        showOutput('Converting... This may take a while.')

        try {
          const qualityMap = { low: 28, medium: 23, high: 18 }
          const crf = qualityMap[quality]

          const result = await send('SHELL_EXEC', {
            command: `ffmpeg -y -i "${input}" -crf ${crf} "${output}"`,
            timeout: 300000,
          })

          if (result.success) {
            showOutput(`Conversion complete!\n\nOutput: ${output}`, 'success')
          } else {
            showOutput(`Conversion failed:\n${result.stderr || result.error}`, 'error')
          }
        } catch (err) {
          showOutput(`Error: ${err.message}`, 'error')
        }
      }

      async function getInfo() {
        const input = document.getElementById('inputPath').value
        if (!input) {
          showOutput('Please select an input file first.', 'error')
          return
        }

        showOutput('Getting file info...')

        try {
          const result = await send('SHELL_EXEC', {
            command: `ffprobe -v quiet -print_format json -show_format -show_streams "${input}"`,
            timeout: 30000,
          })

          if (result.success) {
            const info = JSON.parse(result.stdout)
            showOutput(JSON.stringify(info, null, 2), 'success')
          } else {
            showOutput(`Failed to get info:\n${result.stderr || result.error}`, 'error')
          }
        } catch (err) {
          showOutput(`Error: ${err.message}`, 'error')
        }
      }

      function showOutput(text, type = '') {
        const el = document.getElementById('output')
        el.textContent = text
        el.className = 'output ' + type
      }
    </script>
  </body>
</html>
```

---

## LLM Usage Examples

When an LLM calls a tool, it uses headless mode by default.

### Basic Operations (Shared State)

```json
{
  "action": "search",
  "query": "*.mp4",
  "directory": "C:\\Videos"
}
```

```json
{
  "action": "convert",
  "input": "C:\\Videos\\input.mp4",
  "output": "C:\\Videos\\output.webm",
  "options": { "quality": "high" }
}
```

### Parallel Operations (Isolated State)

Use `parallel: true` when running multiple independent operations:

```json
{
  "action": "convert",
  "input": "C:\\Videos\\video1.mp4",
  "output": "C:\\Videos\\video1.webm",
  "parallel": true
}
```

```json
{
  "action": "convert",
  "input": "C:\\Videos\\video2.mp4",
  "output": "C:\\Videos\\video2.webm",
  "parallel": true
}
```

Each call gets its own isolated state - no interference between operations.

### Using Instance ID for Multi-Step Parallel Workflows

When you need to perform multiple actions on the same isolated instance:

```json
{
  "action": "convert",
  "input": "C:\\Videos\\video1.mp4",
  "output": "C:\\Videos\\video1.webm",
  "parallel": true,
  "_instanceId": "batch_job_1"
}
```

Later, check stats for that specific instance:

```json
{
  "action": "stats",
  "parallel": true,
  "_instanceId": "batch_job_1"
}
```

Clean up when done:

```json
{
  "action": "cleanup",
  "parallel": true,
  "_instanceId": "batch_job_1"
}
```

### Shared State Workflow

Without `parallel`, all calls share state:

```json
{ "action": "convert", "input": "video1.mp4", "output": "out1.webm" }
```

```json
{ "action": "convert", "input": "video2.mp4", "output": "out2.webm" }
```

```json
{ "action": "stats" }
```

The `stats` call returns combined stats from both conversions.

### List Available Actions (Discovery)

```json
{
  "action": null
}
```

Returns list of available actions, parameters, and current instance info.

---

## Best Practices

### 1. Design Headless-First

Always design the core operations first, then wrap them with UI.

```javascript
// GOOD: Core function can be used by both modes
async function compressVideo(input, output, quality, state) { ... }

// Then use in actions
const ACTIONS = {
  compress: (args, state) => compressVideo(args.input, args.output, args.quality, state)
};

// And in UI
async function onCompressClick() {
  // Calls same underlying function via SHELL_EXEC
}
```

### 2. Handle State Properly

```javascript
// GOOD: Pass state to operations, track history
async function processFile(input, state) {
  state.stats.total++
  try {
    const result = doWork(input)
    state.stats.success++
    state.history.push({ input, status: 'success', timestamp: Date.now() })
    return result
  } catch (err) {
    state.stats.failed++
    state.history.push({ input, status: 'failed', error: err.message })
    throw err
  }
}

// GOOD: Clean up parallel instances when done
const ACTIONS = {
  cleanup: async (args, state, instanceId) => {
    cleanupInstance(instanceId)
    return { success: true }
  },
}
```

### 3. Use Parallel for Independent Operations

```javascript
// LLM batch processing - each file isolated
for (const file of files) {
  await callTool({
    action: 'process',
    input: file,
    parallel: true  // Each gets fresh state
  });
}

// LLM sequential workflow - shared state
await callTool({ action: 'setup', config: {...} });
await callTool({ action: 'process', input: 'file1.txt' });
await callTool({ action: 'process', input: 'file2.txt' });
await callTool({ action: 'stats' });  // Gets combined stats
```

### 4. Provide Good Error Messages

```javascript
if (!args.input) {
  throw new Error('Missing required parameter: input. Provide a file path.')
}
```

### 5. Return Structured Results

```javascript
return {
  success: true,
  action: 'convert',
  input: args.input,
  output: args.output,
  duration: '2.5s',
  outputSize: 1024000,
  instanceId, // Always include for traceability
}
```

### 6. Document Actions in Definition

```json
{
  "description": "Video processor. Actions: 'compress', 'extract_audio', 'thumbnail', 'stats', 'cleanup'. Use parallel:true for batch processing."
}
```

### 7. Support Action Discovery

When called without an action, return available actions:

```javascript
if (!action) {
  return {
    availableActions: Object.keys(ACTIONS),
    instanceId,
    parallel: args.parallel || false,
    usage: { ... }
  };
}
```

### 8. Always Include Cleanup Action

For tools with state, provide a cleanup action:

```javascript
cleanup: async (args, state, instanceId) => {
  cleanupInstance(instanceId)
  return { success: true, message: 'Instance cleaned up' }
}
```

---

## .env Support (Optional)

For tools that need configurable settings:

```javascript
const fs = require('fs')
const path = require('path')

function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env')
    const content = fs.readFileSync(envPath, 'utf-8')
    content.split(/\r?\n/).forEach(line => {
      const idx = line.indexOf('=')
      if (idx > 0) {
        const key = line.slice(0, idx).trim()
        const val = line.slice(idx + 1).trim()
        if (key && val && !process.env[key]) {
          process.env[key] = val
        }
      }
    })
  } catch (err) {
    /* .env is optional */
  }
}

loadEnv()
```

---

## Common Pitfalls

| Issue                        | Solution                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| Tool not loading             | Check `inputSchema` (not `input_schema`) and name is lowercase |
| ES module error              | Use `module.exports`, not `export`                             |
| Headless returns HTML        | Check `mode` parameter handling - default should be `headless` |
| Action not found             | Verify action name matches ACTIONS keys exactly                |
| Shell command fails          | Escape paths with quotes: `"path with spaces"`                 |
| Timeout on long operations   | Increase timeout in execSync options                           |
| State bleeding between calls | Use `parallel: true` for isolated operations                   |
| Memory leak with parallel    | Always call `cleanup` action when done with parallel instances |
| Wrong instance state         | Use `_instanceId` to reference specific parallel instance      |
| Stats showing wrong data     | Check if using `parallel: true` when you need shared state     |

---

## Quick Start Checklist

### Headless-Only Tool

- [ ] Create folder: `custom-tools/my_tool/`
- [ ] Create `definition.json` with `mode`, `parallel`, `action` parameters
- [ ] Create `index.js` with state management and ACTIONS dispatcher
- [ ] Implement `stats` and `cleanup` actions for state management
- [ ] Test with `{ "action": "your_action", ... }`
- [ ] Test with `{ "action": "your_action", "parallel": true }` for isolation
- [ ] Restart Yggdrasil to load

### Headless + UI Tool

- [ ] Complete headless checklist above
- [ ] Add `ui.html` with interface
- [ ] Handle `mode: "ui"` in index.js
- [ ] Pass `instanceId` to UI config
- [ ] Test UI calls same operations as headless
- [ ] Restart Yggdrasil to load

---

## State Management Summary

```
┌─────────────────────────────────────────────────────────────┐
│                     TOOL EXECUTION                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  parallel: false (default)     parallel: true               │
│  ┌─────────────────────┐       ┌─────────────────────┐     │
│  │   SHARED STATE      │       │  INSTANCE STATES    │     │
│  │                     │       │                     │     │
│  │  Call 1 ──┐         │       │  Call 1 ─→ State A  │     │
│  │  Call 2 ──┼─→ State │       │  Call 2 ─→ State B  │     │
│  │  Call 3 ──┘         │       │  Call 3 ─→ State C  │     │
│  │                     │       │                     │     │
│  │  All calls share    │       │  Each call isolated │     │
│  │  the same state     │       │  (fresh state)      │     │
│  └─────────────────────┘       └─────────────────────┘     │
│                                                             │
│  Use for:                      Use for:                     │
│  - Sequential workflows        - Batch processing           │
│  - Accumulating stats          - Concurrent operations      │
│  - Multi-step processes        - Independent tasks          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```
