# Custom Tools Development Guide

This guide explains how to build interactive custom tools with file system access, native dialogs, and shell execution capabilities in Yggdrasil.

## The 3-File Pattern

Every tool follows a simple, clean structure:

```
custom-tools/
└── my_tool/
    ├── definition.json   ← Tool metadata (name, description, parameters)
    ├── index.js          ← Minimal backend glue (~15 lines)
    └── ui.html           ← Pure HTML/CSS/JS (the actual UI)
```

**Why this pattern?**

- `ui.html` is pure HTML/CSS/JS - no escape sequences, no template literal issues
- Agents can write normal web code without fighting escaping
- Syntax highlighting works properly in editors
- Easy to debug and test

---

## File 1: definition.json

Defines the tool's name, description, and parameters.

```json
{
  "name": "my_tool",
  "description": "Description shown to the LLM explaining what this tool does",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query or input text"
      },
      "theme": {
        "type": "string",
        "enum": ["dark", "light"],
        "description": "UI theme"
      }
    },
    "required": []
  }
}
```

**Rules:**

- `name` must be lowercase with underscores only (e.g., `my_tool`, not `MyTool`)
- Use `inputSchema` (camelCase), NOT `input_schema`
- Schema `type` must be `"object"`

---

## File 2: index.js

Minimal boilerplate that reads the HTML and injects configuration. **This file rarely needs editing.**

```javascript
const fs = require('fs')
const path = require('path')

module.exports = {
  execute: async function (args) {
    // Read the HTML file
    const htmlPath = path.join(__dirname, 'ui.html')
    let html = fs.readFileSync(htmlPath, 'utf-8')

    // Build config object with args and tool directory
    const config = {
      ...args,
      toolDir: __dirname,
    }

    // Inject config into HTML
    html = html.replace('{{CONFIG}}', JSON.stringify(config))

    return { type: 'text/html', content: html }
  },
}
```

**That's it!** The same ~15 lines work for almost any tool.

---

## File 3: ui.html

This is where all your UI code lives. **Pure HTML, CSS, and JavaScript - no escaping needed!**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Tool</title>

    <!-- Config injected by index.js -->
    <script>
      const CONFIG = {{CONFIG}};
    </script>

    <style>
      /* Normal CSS - no escaping! */
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
    </style>
  </head>
  <body>
    <h1>My Tool</h1>
    <button class="btn" onclick="doSomething()">Click Me</button>
    <div id="output"></div>

    <script>
      // Access config values
      console.log('Tool directory:', CONFIG.toolDir)
      console.log('Theme:', CONFIG.theme)

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

      async function doSomething() {
        document.getElementById('output').textContent = 'Working...'
        // Your code here!
      }
    </script>
  </body>
</html>
```

---

## PostMessage Bridge API

Widgets run in sandboxed iframes. Use the `send()` function to access Electron features:

### File Open Dialog

```javascript
const result = await send('DIALOG_OPEN_FILE', {
  title: 'Select File',
  filters: [{ name: 'Videos', extensions: ['mp4', 'mkv', 'avi'] }],
  properties: ['openFile'], // or ['openDirectory'], ['multiSelections']
})

if (result.success) {
  console.log(result.filePaths) // Array of selected paths
}
```

### File Save Dialog

```javascript
const result = await send('DIALOG_SAVE_FILE', {
  title: 'Save As',
  defaultPath: 'output.txt',
  filters: [{ name: 'Text', extensions: ['txt'] }],
})

if (result.success) {
  console.log(result.filePath) // Selected save path
}
```

### Read File

```javascript
const result = await send('FS_READ_FILE', {
  filePath: '/path/to/file.txt',
  encoding: 'utf-8', // optional
})

if (result.success) {
  console.log(result.content)
}
```

### Write File

```javascript
const result = await send('FS_WRITE_FILE', {
  filePath: '/path/to/output.txt',
  content: 'Hello World',
  encoding: 'utf-8', // optional
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
  cwd: '/working/directory', // optional
  timeout: 300000, // optional, in milliseconds (default: 5 min)
})

if (result.success) {
  console.log('stdout:', result.stdout)
  console.log('stderr:', result.stderr)
} else {
  console.log('Error:', result.error || result.stderr)
  console.log('Exit code:', result.code)
}
```

### HTTP Request (App Automation)

Make HTTP requests to local or remote APIs. This enables custom tools to automate the app itself via the `/api/app/*` endpoints.

```javascript
const result = await send('HTTP_REQUEST', {
  url: 'http://127.0.0.1:3002/api/app/projects',
  method: 'POST', // GET, POST, PUT, DELETE, PATCH
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'My Project',
    user_id: 'user-uuid-here',
  }),
  timeout: 30000, // optional, in milliseconds (default: 30 sec)
})

if (result.success) {
  console.log('Status:', result.status)
  console.log('Data:', result.data)
} else {
  console.log('Error:', result.error)
}
```

---

## App Automation API

Custom tools can automate the Yggdrasil app by calling the local server's `/api/app/*` endpoints using `HTTP_REQUEST`.

**Base URL:** `http://127.0.0.1:3002`

### Create Project

```javascript
const result = await send('HTTP_REQUEST', {
  url: 'http://127.0.0.1:3002/api/app/projects',
  method: 'POST',
  body: JSON.stringify({
    name: 'My New Project',
    user_id: 'your-user-id',
    context: 'Optional project context',
    system_prompt: 'Optional system prompt',
    storage_mode: 'local', // 'local' or 'cloud'
  }),
})
// Returns: { success: true, project: { id, name, ... } }
```

### List Projects

```javascript
const result = await send('HTTP_REQUEST', {
  url: 'http://127.0.0.1:3002/api/app/projects?user_id=your-user-id',
  method: 'GET',
})
// Returns: { success: true, projects: [...] }
```

### Create Conversation

```javascript
const result = await send('HTTP_REQUEST', {
  url: 'http://127.0.0.1:3002/api/app/conversations',
  method: 'POST',
  body: JSON.stringify({
    title: 'New Conversation',
    user_id: 'your-user-id',
    project_id: 'optional-project-id',
    cwd: '/optional/working/directory',
    storage_mode: 'local',
  }),
})
// Returns: { success: true, conversation: { id, title, ... } }
```

### List Conversations

```javascript
const result = await send('HTTP_REQUEST', {
  url: 'http://127.0.0.1:3002/api/app/conversations?user_id=your-user-id',
  method: 'GET',
})
// Returns: { success: true, conversations: [...] }
```

### Get Messages

```javascript
const result = await send('HTTP_REQUEST', {
  url: 'http://127.0.0.1:3002/api/app/conversations/CONVERSATION_ID/messages',
  method: 'GET',
})
// Returns: { success: true, messages: [...] }
```

### Create Message

```javascript
const result = await send('HTTP_REQUEST', {
  url: 'http://127.0.0.1:3002/api/app/messages',
  method: 'POST',
  body: JSON.stringify({
    conversation_id: 'conversation-uuid',
    parent_id: 'optional-parent-message-id',
    role: 'user', // 'user', 'assistant', 'tool', 'system'
    content: 'Hello, this is my message!',
    model_name: 'gpt-4',
  }),
})
// Returns: { success: true, message: { id, content, ... } }
```

### Branch Message

Create a new branch from an existing message (for alternate conversation paths):

```javascript
const result = await send('HTTP_REQUEST', {
  url: 'http://127.0.0.1:3002/api/app/messages/MESSAGE_ID/branch',
  method: 'POST',
  body: JSON.stringify({
    content: 'Alternative response or question',
    role: 'user', // default: 'user'
  }),
})
// Returns: { success: true, message: {...}, parent_id: 'MESSAGE_ID' }
```

### Delete Message

Delete a message and all its descendants:

```javascript
const result = await send('HTTP_REQUEST', {
  url: 'http://127.0.0.1:3002/api/app/messages/MESSAGE_ID',
  method: 'DELETE',
})
// Returns: { success: true, deleted: ['msg-id-1', 'msg-id-2', ...] }
```

---

## Complete Example: File Search Tool

### definition.json

```json
{
  "name": "file_search",
  "description": "Search for files on the system",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Initial search query"
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

module.exports = {
  execute: async function (args) {
    const htmlPath = path.join(__dirname, 'ui.html')
    let html = fs.readFileSync(htmlPath, 'utf-8')

    const config = {
      ...args,
      toolDir: __dirname,
    }

    html = html.replace('{{CONFIG}}', JSON.stringify(config))
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
    <title>File Search</title>
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
        margin-bottom: 20px;
        color: #6366f1;
      }
      .search-box {
        display: flex;
        gap: 12px;
        margin-bottom: 20px;
      }
      .search-input {
        flex: 1;
        padding: 12px 16px;
        font-size: 16px;
        background: #1a1a2e;
        border: 2px solid #2d2d4a;
        border-radius: 8px;
        color: #e2e8f0;
      }
      .search-input:focus {
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
      .results {
        background: #1a1a2e;
        border-radius: 12px;
        padding: 16px;
        max-height: 400px;
        overflow-y: auto;
      }
      .result-item {
        padding: 12px;
        border-bottom: 1px solid #2d2d4a;
        cursor: pointer;
      }
      .result-item:hover {
        background: #2d2d4a;
      }
      .result-item:last-child {
        border-bottom: none;
      }
      .filename {
        font-weight: 500;
      }
      .filepath {
        font-size: 12px;
        color: #64748b;
        margin-top: 4px;
      }
    </style>
  </head>
  <body>
    <h1>🔍 File Search</h1>

    <div class="search-box">
      <input type="text" id="searchInput" class="search-input" placeholder="Search files..." autofocus />
      <button class="btn" onclick="search()">Search</button>
    </div>

    <div class="results" id="results">
      <p style="color: #64748b; text-align: center; padding: 40px;">Enter a search term to find files</p>
    </div>

    <script>
      // PostMessage bridge
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
              reject(new Error('Timeout'))
            }
          }, 60000)
        })
      }

      window.addEventListener('message', e => {
        if (e.data?.requestId && pending.has(e.data.requestId)) {
          pending.get(e.data.requestId).resolve(e.data)
          pending.delete(e.data.requestId)
        }
      })

      // Search on Enter key
      document.getElementById('searchInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') search()
      })

      // Set initial query from config
      if (CONFIG.query) {
        document.getElementById('searchInput').value = CONFIG.query
      }

      async function search() {
        const query = document.getElementById('searchInput').value.trim()
        if (!query) return

        const results = document.getElementById('results')
        results.innerHTML = '<p style="text-align: center; padding: 40px;">Searching...</p>'

        try {
          // Example: Use 'dir' on Windows or 'find' on Unix
          const result = await send('SHELL_EXEC', {
            command: `dir /s /b "*${query}*"`,
            cwd: 'C:\\',
            timeout: 30000,
          })

          if (result.success && result.stdout) {
            const files = result.stdout
              .trim()
              .split('\n')
              .filter(f => f.trim())
            if (files.length === 0) {
              results.innerHTML = '<p style="color: #64748b; text-align: center; padding: 40px;">No files found</p>'
            } else {
              results.innerHTML = files
                .slice(0, 100)
                .map(filepath => {
                  const filename = filepath.split('\\').pop()
                  return `<div class="result-item" onclick="openFolder('${filepath.replace(/\\/g, '\\\\')}')">
                <div class="filename">📄 ${filename}</div>
                <div class="filepath">${filepath}</div>
              </div>`
                })
                .join('')
            }
          } else {
            results.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 40px;">Search failed</p>'
          }
        } catch (err) {
          results.innerHTML = `<p style="color: #ef4444; text-align: center; padding: 40px;">Error: ${err.message}</p>`
        }
      }

      async function openFolder(filepath) {
        await send('SHELL_EXEC', {
          command: `explorer /select,"${filepath}"`,
        })
      }
    </script>
  </body>
</html>
```

---

## .env Support (Optional)

For tools that need configurable settings (API keys, executable paths):

1. Create a `.env` file in your tool directory:

   ```
   API_KEY=your-api-key-here
   SOME_PATH=C:\path\to\something
   ```

2. Load it in `index.js`:

   ```javascript
   const fs = require('fs')
   const path = require('path')

   // Load .env file
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

   module.exports = {
     execute: async function (args) {
       const htmlPath = path.join(__dirname, 'ui.html')
       let html = fs.readFileSync(htmlPath, 'utf-8')

       const config = {
         ...args,
         toolDir: __dirname,
         apiKey: process.env.API_KEY, // Pass env vars to UI if needed
       }

       html = html.replace('{{CONFIG}}', JSON.stringify(config))
       return { type: 'text/html', content: html }
     },
   }
   ```

---

## Common Pitfalls

| Issue                      | Solution                                                       |
| -------------------------- | -------------------------------------------------------------- |
| Tool not loading           | Check `inputSchema` (not `input_schema`) and name is lowercase |
| ES module error            | Use `module.exports`, not `export`                             |
| CONFIG is undefined        | Make sure `{{CONFIG}}` placeholder exists in ui.html           |
| File dialog not working    | Ensure you're running in Electron, not browser                 |
| Shell command fails        | Escape paths with quotes: `"path with spaces"`                 |
| Timeout on long operations | Increase timeout in send() and SHELL_EXEC options              |

---

## Tips

1. **Start with the template** - Copy the 3 files above and modify
2. **Keep index.js minimal** - All UI logic goes in ui.html
3. **Use CONFIG for dynamic values** - Pass data from index.js to ui.html via the config object
4. **Test incrementally** - Build the UI step by step
5. **Use browser dev tools** - Right-click → Inspect to debug your widget

---

## Quick Start Checklist

- [ ] Create folder: `custom-tools/my_tool/`
- [ ] Create `definition.json` with name, description, inputSchema
- [ ] Create `index.js` (copy the template - rarely needs changes)
- [ ] Create `ui.html` with your UI code
- [ ] Restart Yggdrasil to load the new tool
