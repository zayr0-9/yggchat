# Custom Tools Development Guide

Custom tools run inside Yggdrasil's Electron sandbox using **Electron's bundled Node.js** - users don't need Node.js installed separately (like VS Code extensions).

## Architecture

```
custom-tools/
└── my_tool/
    ├── definition.json   ← Tool metadata (required)
    ├── index.js          ← Server logic (required, CommonJS)
    └── ui.html           ← Optional UI
```

**Key Rules:**

- Use **CommonJS** (`require`/`module.exports`), NOT ES modules (`import`/`export`)
- `name` must be lowercase with underscores: `my_tool`, not `MyTool`
- Use `inputSchema` (camelCase), not `input_schema`

---

## File 1: definition.json

```json
{
  "name": "my_tool",
  "description": "What this tool does. List available headless actions here.",
  "appPermissions": {
    "agent": "read"
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["headless", "ui"],
        "default": "headless"
      },
      "action": {
        "type": "string",
        "enum": ["search", "convert"],
        "description": "Headless action to perform"
      },
      "input": { "type": "string" },
      "output": { "type": "string" }
    },
    "required": []
  }
}
```

**Optional appPermissions**

- `agent: "read"` allows the UI to read the current persistent agent session.
- `agent: "write"` allows the UI to enqueue tasks into the persistent agent queue.
- Omit `appPermissions` to deny agent access.

---

---

## UI Pattern (Componentized, No Build Tools)

UI runs in an iframe. Keep `ui.html` tiny and load components at runtime using `FS_READ_FILE`. This makes large apps easier to maintain without bundlers.

**Recommended Structure**

```
my_tool/
├── ui.html
└── ui/
    ├── manifest.json
    └── components/
        ├── header/
        │   ├── component.html
        │   ├── component.css
        │   └── component.js
        ├── controls/
        │   ├── component.html
        │   ├── component.css
        │   └── component.js
        └── app/
            └── component.js
```

**manifest.json (ordered list of components)**

```json
{
  "version": 1,
  "components": [
    { "id": "base", "css": "components/base/component.css" },
    {
      "id": "header",
      "mount": "header",
      "html": "components/header/component.html",
      "css": "components/header/component.css"
    },
    {
      "id": "controls",
      "mount": "controls",
      "html": "components/controls/component.html",
      "css": "components/controls/component.css",
      "js": "components/controls/component.js"
    },
    { "id": "app", "js": "components/app/component.js" }
  ]
}
```

**ui.html (loader + IPC bridge + mounts)**

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Tool</title>
  </head>
  <body>
    <div data-mount="header"></div>
    <div data-mount="controls"></div>
    <div data-mount="main"></div>

    <script>
      const CONFIG = {{CONFIG}};

      // IPC Request System
      let reqId = 0;
      const pending = new Map();

      function send(type, options = {}) {
        return new Promise((resolve, reject) => {
          const id = `r${++reqId}_${Date.now()}`;
          pending.set(id, { resolve, reject });
          window.parent.postMessage({ type, requestId: id, options }, "*");
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              reject(new Error("Request timeout"));
            }
          }, 60000);
        });
      }

      window.addEventListener("message", (e) => {
        if (e.data?.requestId && pending.has(e.data.requestId)) {
          pending.get(e.data.requestId).resolve(e.data);
          pending.delete(e.data.requestId);
        }
      });

      window.APP = {
        config: CONFIG,
        send,
        state: {},
        on: (event, handler) => {
          window.APP._events = window.APP._events || new Map();
          if (!window.APP._events.has(event)) {
            window.APP._events.set(event, new Set());
          }
          window.APP._events.get(event).add(handler);
        },
        emit: (event, payload) => {
          const handlers = window.APP._events?.get(event);
          if (!handlers) return;
          handlers.forEach((fn) => fn(payload));
        }
      };

      const toolDir = CONFIG.toolDir || "";
      const sep = toolDir.includes("\\\\") ? "\\\\" : "/";
      const uiDir = toolDir ? `${toolDir}${sep}ui` : "";
      const manifestPath = uiDir ? `${uiDir}${sep}manifest.json` : "";

      function resolvePath(filePath) {
        if (!filePath || !uiDir) return filePath;
        if (/^[A-Za-z]:[\\\\/]/.test(filePath) || filePath.startsWith("\\\\")) {
          return filePath;
        }
        return `${uiDir}${sep}${filePath.replace(/^[/\\\\]+/, "")}`;
      }

      async function readText(filePath) {
        const res = await send("FS_READ_FILE", { filePath, encoding: "utf-8" });
        if (!res?.success) throw new Error(res?.error || "Read failed");
        return res.content || "";
      }

      async function loadComponent(entry) {
        if (entry.css) {
          const css = await readText(resolvePath(entry.css));
          const style = document.createElement("style");
          style.dataset.component = entry.id || "";
          style.textContent = css;
          document.head.appendChild(style);
        }

        if (entry.html) {
          const mount = document.querySelector(`[data-mount="${entry.mount}"]`);
          const html = await readText(resolvePath(entry.html));
          if (entry.mode === "replace") mount.innerHTML = html;
          else mount.insertAdjacentHTML("beforeend", html);
        }

        if (entry.js) {
          const js = await readText(resolvePath(entry.js));
          const script = document.createElement("script");
          script.dataset.component = entry.id || "";
          script.textContent = js;
          document.body.appendChild(script);
        }
      }

      async function loadManifest() {
        const manifestText = await readText(manifestPath);
        const manifest = JSON.parse(manifestText);
        for (const entry of manifest.components || []) {
          await loadComponent(entry);
        }
      }

      loadManifest();
    </script>
  </body>
</html>
```

**Reload Button (hot reload without tooling)**

Add a simple reload button in any component:

```html
<button id="reloadUi" type="button">RELOAD UI</button>
```

And wire it in your JS:

```javascript
const reloadUi = document.getElementById('reloadUi')
reloadUi.addEventListener('click', () => window.location.reload())
```

---

## IPC Handlers Reference

### Dialogs

```javascript
// Open file picker
const res = await send('DIALOG_OPEN_FILE', {
  title: 'Select File',
  defaultPath: '/home/user',
  filters: [{ name: 'Images', extensions: ['png', 'jpg'] }],
  properties: ['openFile', 'multiSelections'], // 'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'
})
// Returns: { success, filePaths: ['/path/to/file1.png', ...], canceled }

// Save file dialog
const res = await send('DIALOG_SAVE_FILE', {
  title: 'Save As',
  defaultPath: 'output.pdf',
  filters: [{ name: 'PDF', extensions: ['pdf'] }],
})
// Returns: { success, filePath: '/path/to/output.pdf', canceled }
```

### Filesystem

```javascript
// Read file
const res = await send('FS_READ_FILE', {
  filePath: '/path/to/file.txt',
  encoding: 'utf-8', // optional, defaults to utf-8
})
// Returns: { success, content: '...' } or { success: false, error: '...' }

// Write file
const res = await send('FS_WRITE_FILE', {
  filePath: '/path/to/output.txt',
  content: 'Hello World',
  encoding: 'utf-8', // For binary: 'base64'
})
// Returns: { success: true } or { success: false, error: '...' }

// Create directory
const res = await send('FS_MKDIR', { dirPath: '/path/to/new/dir' })
// Returns: { success: true }

// Get file stats
const res = await send('FS_STAT', { filePath: '/path/to/file' })
// Returns: { success, size, mtime, isFile, isDirectory, ... }

// Read file as stream (for large files)
const res = await send('FS_READ_FILE_STREAM', {
  filePath: '/path/to/large-file.bin',
  encoding: 'utf-8', // optional
  highWaterMark: 65536, // chunk size, optional
})
// Returns: { success, streamId }
// Then listen for stream events (see below)

// Abort stream
await send('FS_ABORT', { streamId: 'stream-id-here' })
```

#### Stream Events (listen via message handler)

```javascript
window.addEventListener('message', e => {
  switch (e.data.type) {
    case 'FS_READ_FILE_STREAM_CHUNK':
      console.log('Chunk:', e.data.chunk, 'streamId:', e.data.streamId)
      break
    case 'FS_READ_FILE_STREAM_PROGRESS':
      console.log('Progress:', e.data.progress, '%')
      break
    case 'FS_READ_FILE_STREAM_END':
      console.log('Stream complete')
      break
    case 'FS_READ_FILE_STREAM_ERROR':
      console.error('Stream error:', e.data.error)
      break
    case 'FS_READ_FILE_STREAM_ABORTED':
      console.log('Stream aborted')
      break
  }
})
```

### Shell Execution

```javascript
const res = await send('SHELL_EXEC', {
  command: 'ls -la /home/user',
  cwd: '/optional/working/dir', // optional
  timeout: 30000, // optional, ms
})
// Returns: { success, stdout: '...', stderr: '...', code: 0 }
```

### HTTP Requests

```javascript
const res = await send('HTTP_REQUEST', {
  url: 'https://api.example.com/data',
  method: 'POST', // GET, POST, PUT, DELETE, etc.
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer token',
  },
  body: JSON.stringify({ key: 'value' }),
  timeout: 10000, // optional, ms
})
// Returns: { success, status, data, headers }
```

### Generic RPC (Access Any electronAPI)

For handlers not explicitly bridged, use the RPC interface:

```javascript
// Allowed namespaces: 'fs', 'dialog', 'shell', 'exec', 'http', 'storage', 'platformInfo'
const res = await send('RPC', {
  namespace: 'shell',
  method: 'openPath',
  args: ['/path/to/folder'],
})
// Returns: { success, result: ... }

// Example: Get platform info
const platform = await send('RPC', {
  namespace: 'platformInfo',
  method: 'get',
  args: [],
})
// Returns: { success, result: { platform: 'win32', arch: 'x64', ... } }

// Example: Storage
await send('RPC', {
  namespace: 'storage',
  method: 'set',
  args: ['myKey', { data: 123 }],
})
const stored = await send('RPC', {
  namespace: 'storage',
  method: 'get',
  args: ['myKey'],
})
```

### Auth Context

```javascript
const res = await send('AUTH_CONTEXT', {})
// Returns: { success: true, tenantId: 'user-tenant-id' }
```

### Global Agent Context (Persistent Agent)

Requires `appPermissions.agent` in `definition.json`.

```javascript
// Read current agent state (conversationId, sessionId, status)
const state = await send('AGENT_CONTEXT', {})

// Read current agent conversation messages (latest 50)
const messages = await send('AGENT_MESSAGES', { limit: 50 })

// Read agent task queue (pending by default)
const tasks = await send('AGENT_TASKS', { status: 'pending' })

// Enqueue a task (requires appPermissions.agent = "write")
await send('AGENT_ENQUEUE_TASK', {
  description: 'Summarize today\'s weather and post a short update.',
  payload: { city: 'San Francisco', cadence: 'hourly' },
})

// Subscribe to agent events (state/stream/message)
const sub = await send('AGENT_SUBSCRIBE', {})
window.addEventListener('message', e => {
  if (e.data?.type !== 'AGENT_EVENT') return
  if (e.data.subscriptionId !== sub.subscriptionId) return
  // e.data.event = { type: 'state' | 'stream' | 'message' | 'error', ... }
  console.log('Agent event:', e.data.event)
})

// Unsubscribe
await send('AGENT_UNSUBSCRIBE', {})
```

### Execute Tool (Electron's Node.js - No Install Required!)

**This is the recommended way** for UI to call tool actions. Runs your tool's `index.js` directly in Electron's bundled Node.js runtime with full `node_modules` support.

```javascript
// Execute tool's index.js directly
const res = await send('CUSTOM_TOOL_EXECUTE', {
  toolPath: CONFIG.toolDir, // Path to your tool directory
  args: {
    mode: 'headless',
    action: 'list',
    // ... other action params
  },
})
// Returns: result from your tool's execute() function

// Example: Call note_taker's list action
const notes = await send('CUSTOM_TOOL_EXECUTE', {
  toolPath: CONFIG.toolDir,
  args: { mode: 'headless', action: 'list' },
})
console.log(notes.notes) // [{ id: 123, text: '...' }, ...]

// Example: Add a note
await send('CUSTOM_TOOL_EXECUTE', {
  toolPath: CONFIG.toolDir,
  args: { mode: 'headless', action: 'add', text: 'New note!' },
})
```

### Clear Module Cache (Hot Reload)

Clear cached modules to pick up code changes without restarting Electron:

```javascript
// Clear cache for specific tool
await send('CUSTOM_TOOL_CLEAR_CACHE', { toolPath: CONFIG.toolDir })

// Clear all cached tool modules
await send('CUSTOM_TOOL_CLEAR_CACHE', {})
```

**Benefits over SHELL_EXEC:**

- ✅ No Node.js installation required on user's system
- ✅ Uses Electron's bundled Node.js (like VS Code extensions)
- ✅ Supports `node_modules` in your tool directory
- ✅ Faster execution (no process spawn overhead)
- ✅ Hot reload with cache clearing

---

## LLM Generation (Ephemeral Endpoint)

Call Yggdrasil's LLM for AI-powered features. Supports text and image generation.

### Text Generation

```javascript
const res = await send('REQUEST_GENERATION', {
  prompt: 'Explain quantum computing in simple terms',
  model: 'anthropic/claude-sonnet-4', // or 'google/gemini-3-flash-preview'
  maxTokens: 4096, // optional
  temperature: 0.7, // optional
  systemPrompt: 'You are a helpful assistant.', // optional
  attachmentsBase64: [
    // optional, for vision models
    { dataUrl: 'data:image/jpeg;base64,...', type: 'image/jpeg' },
  ],
})
// Returns: { success, text: '...', images: [] }
```

### Streaming Text (Real-time chunks)

```javascript
async function generateWithStreaming(prompt) {
  const myReqId = `gen_${Date.now()}`
  let fullText = ''

  const handler = e => {
    if (e.data?.requestId !== myReqId) return

    switch (e.data.type) {
      case 'REQUEST_GENERATION_CHUNK':
        // Incremental text
        console.log('Chunk:', e.data.chunk)
        fullText = e.data.text // cumulative
        document.getElementById('output').textContent = fullText
        break
      case 'REQUEST_GENERATION_REASONING':
        // For thinking models (o1, etc.)
        console.log('Reasoning:', e.data.reasoning)
        break
      case 'REQUEST_GENERATION_RESPONSE':
        // Final response
        window.removeEventListener('message', handler)
        console.log('Done:', e.data.text)
        break
    }
  }

  window.addEventListener('message', handler)
  window.parent.postMessage(
    {
      type: 'REQUEST_GENERATION',
      requestId: myReqId,
      options: { prompt, model: 'google/gemini-3-flash-preview' },
    },
    '*'
  )
}
```

### Image Generation

```javascript
async function generateImage(prompt) {
  return new Promise(resolve => {
    const myReqId = `img_${Date.now()}`
    let imageUrl = null

    const handler = e => {
      if (e.data?.requestId !== myReqId) return

      // Capture image as it arrives
      if (e.data.type === 'REQUEST_GENERATION_IMAGE') {
        const img = e.data.image
        imageUrl = typeof img === 'string' ? img : img?.url
      }

      // Final response
      if (e.data.type === 'REQUEST_GENERATION_RESPONSE') {
        window.removeEventListener('message', handler)

        // Fallback: check response for images
        if (!imageUrl && e.data.images?.length) {
          const img = e.data.images[0]
          imageUrl = typeof img === 'string' ? img : img.url
        }

        resolve({ success: !!imageUrl, imageUrl })
      }
    }

    window.addEventListener('message', handler)
    window.parent.postMessage(
      {
        type: 'REQUEST_GENERATION',
        requestId: myReqId,
        options: {
          prompt,
          model: 'google/gemini-2.5-flash-preview-image-generation',
        },
      },
      '*'
    )
  })
}

// Usage
const result = await generateImage('A futuristic city skyline at sunset')
if (result.success) {
  document.getElementById('preview').src = result.imageUrl

  // Save to file (base64)
  const base64 = result.imageUrl.split(',')[1]
  await send('FS_WRITE_FILE', {
    filePath: CONFIG.toolDir + '/output/image.png',
    content: base64,
    encoding: 'base64',
  })
}
```

---

## Complete Example: Note Taker

### definition.json

```json
{
  "name": "note_taker",
  "description": "Note storage. Actions: 'list', 'add' (text param), 'clear'",
  "inputSchema": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["headless", "ui"],
        "default": "headless"
      },
      "action": { "type": "string", "enum": ["list", "add", "clear"] },
      "text": { "type": "string" }
    }
  }
}
```

### index.js

```javascript
const fs = require('fs')
const path = require('path')

const NOTES_FILE = path.join(__dirname, 'notes.json')

const loadNotes = () => {
  try {
    return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'))
  } catch {
    return []
  }
}

const saveNotes = notes => fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2))

const ACTIONS = {
  list: async () => ({ success: true, notes: loadNotes() }),
  add: async args => {
    if (!args.text) return { success: false, error: 'Missing text' }
    const notes = loadNotes()
    notes.push({
      id: Date.now(),
      text: args.text,
      created: new Date().toISOString(),
    })
    saveNotes(notes)
    return { success: true }
  },
  clear: async () => {
    saveNotes([])
    return { success: true }
  },
}

async function execute(args) {
  if (args.mode !== 'ui') {
    const fn = ACTIONS[args.action]
    if (!fn)
      return {
        type: 'application/json',
        content: JSON.stringify({ error: 'Invalid action' }),
      }
    return {
      type: 'application/json',
      content: JSON.stringify(await fn(args)),
    }
  }

  let html = fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf-8')
  html = html.replace('{{CONFIG}}', JSON.stringify({ toolDir: __dirname, notes: loadNotes() }))
  return { type: 'text/html', content: html }
}

module.exports = { execute }
```

### ui.html

```html
<!DOCTYPE html>
<html>
  <head>
    <style>
      body {
        font-family: system-ui;
        padding: 20px;
        background: #1a1a2e;
        color: #eee;
      }
      input {
        padding: 10px;
        width: 300px;
        background: #2d2d4a;
        border: 1px solid #444;
        color: #eee;
      }
      button {
        padding: 10px 20px;
        background: #6366f1;
        color: white;
        border: none;
        cursor: pointer;
      }
      .note {
        padding: 10px;
        margin: 5px 0;
        background: #2d2d4a;
        border-radius: 4px;
      }
    </style>
    <script>
      const CONFIG = {{CONFIG}};
      let reqId = 0;
      const pending = new Map();

      function send(type, options = {}) {
        return new Promise((resolve) => {
          const id = `r${++reqId}_${Date.now()}`;
          pending.set(id, { resolve });
          window.parent.postMessage({ type, requestId: id, options }, '*');
        });
      }

      window.addEventListener('message', (e) => {
        if (e.data?.requestId && pending.has(e.data.requestId)) {
          pending.get(e.data.requestId).resolve(e.data);
          pending.delete(e.data.requestId);
        }
      });
    </script>
  </head>
  <body>
    <h2>Notes</h2>
    <input type="text" id="noteInput" placeholder="Enter note..." />
    <button onclick="addNote()">Add</button>
    <button onclick="summarize()">AI Summarize</button>
    <div id="notes"></div>
    <div id="summary" style="margin-top:20px; padding:10px; background:#3d3d5a; display:none;"></div>

    <script>
      function render(notes) {
        document.getElementById('notes').innerHTML = notes.map(n => `<div class="note">${n.text}</div>`).join('')
      }

      async function addNote() {
        const input = document.getElementById('noteInput')
        const text = input.value.trim()
        if (!text) return

        // Call headless action via Electron's Node.js (no install required!)
        await send('CUSTOM_TOOL_EXECUTE', {
          toolPath: CONFIG.toolDir,
          args: { mode: 'headless', action: 'add', text },
        })

        // Refresh list
        const res = await send('CUSTOM_TOOL_EXECUTE', {
          toolPath: CONFIG.toolDir,
          args: { mode: 'headless', action: 'list' },
        })
        render(res.notes || [])
        input.value = ''
      }

      async function summarize() {
        const notes = CONFIG.notes.map(n => n.text).join('\n- ')
        if (!notes) return alert('No notes to summarize')

        const res = await send('REQUEST_GENERATION', {
          prompt: `Summarize these notes concisely:\n- ${notes}`,
          model: 'google/gemini-3-flash-preview',
        })

        const el = document.getElementById('summary')
        el.style.display = 'block'
        el.innerHTML = `<strong>AI Summary:</strong><br>${res.text}`
      }

      render(CONFIG.notes)
    </script>
  </body>
</html>
```

---

## Tips

1. **Always return JSON** for headless mode: `{ success: true/false, ... }`
2. **Use CUSTOM_TOOL_EXECUTE** instead of SHELL_EXEC - no Node.js install required
3. **Cross-platform paths**: Check `CONFIG.toolDir.includes('\\')` for Windows
4. **Hot reload**: Use `CUSTOM_TOOL_CLEAR_CACHE` after editing `index.js`
5. **node_modules**: Install packages in your tool directory - they work automatically
6. **LLM models**:
   - Text: `anthropic/claude-sonnet-4`, `google/gemini-3-flash-preview`
   - Image: `google/gemini-2.5-flash-preview-image-generation`
7. **Binary files**: Use `encoding: 'base64'` for FS_WRITE_FILE
