# Custom App HTML Frame Context

This document explains how custom apps (custom tools with UI) are loaded, rendered, persisted, and granted access to host capabilities in ygg-chat. It covers both inline rendering in chat messages and the Tool Manager (HTML tools modal) overlay system.

## 1) What a custom app is

A custom app is a **custom tool** that optionally returns HTML to render in an iframe. The tool lives in the custom tools directory and provides:

- `definition.json` (metadata + input schema + optional app permissions)
- `index.js` (CommonJS execute function)
- `ui.html` (optional UI)

The tool can be invoked in two ways:

1) **Headless**: `execute()` performs a task and returns data.
2) **UI**: `execute()` returns `{ html: "<html>..." }` to render in an iframe.


## 2) Files, locations, and discovery

### 2.1 Custom tools directory

Custom tools are loaded from the Electron userData path:

- `~/.config/yggdrasil/custom-tools/<tool_name>/`

This path is resolved inside Electron. The loader seeds a copy of `CUSTOM_TOOLS_GUIIDE.md` into that directory for guidance.

### 2.2 Tool discovery and registration

At app startup and on manual reload:

- The Electron local server scans custom tools.
- Each valid tool is registered with the custom tool registry.
- The client fetches definitions via `GET /api/custom-tools` and merges them into tool definitions.

Custom tools are **not** sent to the model directly. The model discovers them via `custom_tool_manager` (built-in tool) and executes them via `custom_tool_manager` with `action: "invoke"`.


## 3) Tool definition shape (custom)

A custom tool definition may include **appPermissions**, which are used to gate iframe access:

```json
{
  "name": "my_tool",
  "description": "...",
  "enabled": true,
  "appPermissions": { "agent": "read" },
  "inputSchema": { "type": "object", "properties": {} }
}
```

Supported permissions:

- `agent: "read"`  -> read persistent agent context/messages/tasks
- `agent: "write"` -> enqueue tasks into the persistent agent queue

If `appPermissions` is missing, the app has **no agent access**.


## 4) How HTML UI is produced

Your tool’s `execute()` returns HTML in either of these shapes:

```js
return { success: true, html: "<html>...</html>", toolName: "my_tool" }
```

Or a typed payload:

```js
return { success: true, type: "text/html", content: "<html>...</html>" }
```

The renderer expects HTML to be **trusted only as input**, and it still re-sanitizes before rendering.

When HTML is returned through `custom_tool_manager` invoke, the manager stamps `toolName` on HTML-shaped responses if missing. This preserves iframe permission mapping for `appPermissions`.


## 5) Rendering paths (two paths)

### 5.1 Inline rendering (Chat message)

When a tool result is displayed inline in the chat:

- `ChatMessage` detects HTML results.
- It renders an iframe directly with `srcDoc`.
- The iframe is wired to the **shared iframe bridge** for IPC access.

This path is the simplest. The tool name is derived from the tool call group and passed to the iframe bridge.

### 5.2 Tool Manager (HtmlIframeRegistry)

The Tool Manager is an overlay system that:

- Stores HTML entries in a registry
- Positions iframes over "slots" using fixed positioning
- Keeps iframes alive while moving them between slots

The registry uses a **hidden iframe host** and overlays the iframe on its slot via CSS positioning. This avoids DOM unmounts when switching views and supports hibernation and caching.


## 6) HtmlIframeRegistry and entries

HTML tool outputs are stored as **entries** with metadata:

```ts
{ key, html, label, status, sizeBytes, timestamps, conversationId, projectId, toolName }
```

Key features:

- **Persistent cache** in SQLite (`html_tools` table)
- **Auto-hibernate** and **auto-evict** based on TTL and size limits
- **Favorites** to prevent hibernation

The `toolName` field is critical for permission checks in the iframe bridge.


## 7) Iframe bridge (IPC surface)

### 7.1 How the bridge is attached

All custom app iframes are attached to the same shared bridge:

- Inline chat: `ChatMessage` attaches the bridge directly
- Tool Manager: `HtmlIframeRegistry` attaches the bridge and tracks toolName

The bridge is implemented in:

- `client/ygg-chat-r/src/utils/iframeBridge.ts`

### 7.2 IPC request pattern

The iframe sends a request to the host:

```js
window.parent.postMessage({ type, requestId, options }, "*")
```

The host responds with:

```js
{ type: `${type}_RESPONSE`, requestId, success, ... }
```

### 7.3 Built-in IPC handlers

The bridge supports many handlers, including:

- File dialogs, filesystem, shell, http, storage
- `CUSTOM_TOOL_EXECUTE` / `CUSTOM_TOOL_CLEAR_CACHE`
- `REQUEST_GENERATION` (LLM calls)

See `CUSTOM_TOOLS_GUIIDE.md` for all supported handlers.


## 8) Agent integration (new)

Custom apps can now access the **persistent agent** via IPC. This is gated by `appPermissions.agent`.

### 8.1 Read access

- `AGENT_CONTEXT` -> state (status, sessionId, conversationId)
- `AGENT_MESSAGES` -> messages for current agent conversation
- `AGENT_TASKS` -> queued tasks

### 8.2 Write access

- `AGENT_ENQUEUE_TASK` -> add a task to the agent queue

### 8.3 Subscription

- `AGENT_SUBSCRIBE` -> push events from the agent loop
- `AGENT_UNSUBSCRIBE` -> stop pushing


## 9) Permission enforcement

The bridge resolves permission like this:

1) Find **toolName** for the iframe
2) Lookup the tool definition in the merged tool registry
3) Verify `tool.isCustom` and `tool.appPermissions.agent`

If missing or invalid, the bridge returns:

- `Agent access not permitted` (read)
- `Agent write access not permitted` (write)


## 10) Persistence and caching

### 10.1 SQLite cache

HTML entries are stored in `html_tools` (local SQLite). Fields include:

- `tool_name` (new) for permission mapping
- `conversation_id`, `project_id` for context

### 10.2 Hibernation

Entries can be hibernated (hidden) when:

- idle for too long
- too many active apps

Favorites are not auto-hibernated.

### 10.3 Eviction

Entries are removed when:

- TTL expired
- storage exceeds max bytes
- max cached entries exceeded


## 11) Known integration points

### 11.1 Custom tool loader

`electron/tools/customToolLoader.ts` parses `definition.json` and now preserves `appPermissions`.

### 11.2 HtmlIframeRegistry

`HtmlIframeRegistry` owns:

- entry cache
- iframe lifecycle
- positioning
- toolName propagation

### 11.3 ChatMessage

`ChatMessage` renders inline iframes and passes toolName for permission checks.


## 12) Debug checklist (permissions)

If an app shows "Agent access not permitted":

1) Confirm tool is **custom** and has `appPermissions.agent`.
2) Ensure the **iframe has toolName** (new entries only).
3) Remove old cached HTML entries and re-render the UI.
4) Reload custom tools or restart app.


## 13) Minimal tool example

```json
// definition.json
{
  "name": "agent_queue_test",
  "description": "Test UI",
  "enabled": true,
  "appPermissions": { "agent": "write" },
  "inputSchema": { "type": "object", "properties": {} }
}
```

```js
// index.js
module.exports.execute = async () => {
  return { success: true, html: "<html>...</html>", toolName: "agent_queue_test" }
}
```

```html
<!-- ui.html -->
<script>
  // example
  await send('AGENT_ENQUEUE_TASK', { description: 'hello world' })
</script>
```


## 14) Notes on security and trust boundaries

- The iframe is sandboxed (`allow-scripts` and limited permissions).
- IPC requests are the **only** supported bridge to host functions.
- Permissions are enforced on the host side, not in the iframe.


---

If you want this document expanded into a formal developer guide, I can add API schemas, lifecycle diagrams, and UI flow charts.
