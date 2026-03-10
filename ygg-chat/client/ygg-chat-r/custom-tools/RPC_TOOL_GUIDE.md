# RPC Tool Guide (Headless + iframe JSON-RPC)

This guide explains how to build **custom tools with UI** that run in the **headless/mobile iframe runtime** using Yggdrasil's JSON-RPC bridge.

> Scope: current MVP RPC implementation for custom tool iframes in headless UI.

---

## 1) Architecture overview

Custom tool UI runs in an iframe and talks to host via `window.parent.postMessage`.

In headless/mobile:
- iframe messages are handled by a bridge (`customToolIframeBridge.ts`)
- bridge calls server JSON-RPC endpoint:
  - `POST /api/headless/custom-tools/rpc`
- server dispatches supported methods:
  - `customTool.invoke`
  - `fs.readFile`
  - `auth.context`
  - `http.request`

Legacy postMessage types are also mapped (for backward compatibility), but **new apps should use JSON-RPC directly**.

---

## 2) JSON-RPC request/response shape

Use JSON-RPC 2.0 over postMessage.

### Request

```json
{
  "jsonrpc": "2.0",
  "id": "req_123",
  "method": "customTool.invoke",
  "params": {}
}
```

### Success response

```json
{
  "jsonrpc": "2.0",
  "id": "req_123",
  "result": { "success": true }
}
```

### Error response

```json
{
  "jsonrpc": "2.0",
  "id": "req_123",
  "error": {
    "code": -32601,
    "message": "Unsupported method: xyz"
  }
}
```

---

## 3) Supported methods (MVP)

## 3.1 `customTool.invoke`
Invoke a custom tool headless action (same behavior as `custom_tool_manager invoke`).

### Params
- `name` (string, recommended)
- `args` (object)
- `toolPath` (optional legacy fallback)
- `bustCache` (boolean, optional)
- optional execution context fields: `rootPath`, `cwd`, `conversationId`, `messageId`, `streamId`, `operationMode`

### Example

```json
{
  "jsonrpc": "2.0",
  "id": "invoke_1",
  "method": "customTool.invoke",
  "params": {
    "name": "my_tool",
    "args": {
      "mode": "headless",
      "action": "list"
    }
  }
}
```

---

## 3.2 `fs.readFile`
Read a file through the server tool runtime (`read_file`).

### Params (subset)
- `path` (or `filePath`)
- `cwd` (optional)
- `maxBytes`, `startLine`, `endLine`, `ranges`, `includeHash`

### Example

```json
{
  "jsonrpc": "2.0",
  "id": "fs_1",
  "method": "fs.readFile",
  "params": {
    "path": "README.md",
    "maxBytes": 200000
  }
}
```

---

## 3.3 `auth.context`
Get auth/tenant context from host.

### Example

```json
{
  "jsonrpc": "2.0",
  "id": "auth_1",
  "method": "auth.context",
  "params": {}
}
```

Typical result:

```json
{
  "success": true,
  "tenantId": "...or null..."
}
```

---

## 3.4 `http.request`
Server-side HTTP proxy request.

### Params
- `url` (required)
- `method`, `headers`, `body`, `timeout`

### Example

```json
{
  "jsonrpc": "2.0",
  "id": "http_1",
  "method": "http.request",
  "params": {
    "url": "https://example.com/api",
    "method": "GET",
    "timeout": 10000
  }
}
```

---

## 4) Legacy compatibility mapping (implemented)

The headless bridge maps these old message types to JSON-RPC:

- `CUSTOM_TOOL_EXECUTE` -> `customTool.invoke`
- `FS_READ_FILE` -> `fs.readFile`
- `AUTH_CONTEXT` -> `auth.context`
- `HTTP_REQUEST` -> `http.request`

So old apps may still work, but use native JSON-RPC for new development.

---

## 5) Minimal UI RPC client snippet

```html
<script>
  let rpcId = 0;
  const pending = new Map();

  function rpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = `rpc_${++rpcId}_${Date.now()}`;
      pending.set(id, { resolve, reject });

      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');

      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('RPC timeout'));
      }, 120000);
    });
  }

  window.addEventListener('message', event => {
    const msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0' || !msg.id) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);

    if (msg.error) p.reject(new Error(msg.error.message || 'RPC error'));
    else p.resolve(msg.result);
  });
</script>
```

---

## 6) Best practices for headless custom apps

1. **Split UI mode and headless mode**
   - `mode: "ui"` -> return HTML
   - `mode: "headless"` -> return structured JSON

2. **Always return stable JSON from headless actions**
   - `{ success: true, ... }` or `{ success: false, error: "..." }`

3. **Store mutable app data under `resources/`**
   - `resources/uploads`, `resources/output`, state files, cache

4. **Design mobile-safe download flows**
   - auto-download attempt may fail in iframe/mobile
   - include manual fallback link/button

5. **Keep RPC calls explicit and small**
   - avoid huge payloads where possible
   - prefer action-style APIs in your `index.js`

6. **Do not assume Electron desktop APIs in headless**
   - use RPC methods above instead of `window.electronAPI`

---

## 7) Security model notes

- Server enforces RPC method whitelist.
- Cross-tool invocation is blocked when iframe has tool context.
- File operations run through server tool runtime constraints.

Build your app assuming **server-authorized capabilities only**.

---

## 8) Example custom tool invoke pattern

```js
async function callMyAction(action, payload = {}) {
  const result = await rpc('customTool.invoke', {
    name: 'my_tool',
    args: {
      mode: 'headless',
      action,
      ...payload,
    },
  });

  if (!result || result.success !== true) {
    throw new Error(result?.error || `Action failed: ${action}`);
  }

  return result;
}
```

---

## 9) Current limitations (MVP)

Not yet in this RPC surface:
- file dialogs (`DIALOG_*`)
- write/stream fs parity (`FS_WRITE_FILE_STREAM`, etc.)
- agent subscription/event bridge parity
- full generation/LLM parity under this RPC namespace

Add these in future phases as needed.
