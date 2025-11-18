# Implementation Plan: Single Electron App with WSL Tool Bridge

This plan outlines how to ship a single Windows Electron application while allowing it to execute development tools (like `ripgrep`, `glob`, `fs`) inside a WSL environment when necessary.

## Core Architecture

1.  **Platform**: Windows (Native Electron App).
2.  **Server**: Embedded Node.js server running natively on Windows (spawned by Electron).
3.  **Connectivity**:
    *   **Electron Renderer** ↔ **Server**: `http://localhost:3001`
    *   **VS Code Extension (WSL)** ↔ **Server**: `ws://localhost:3001/ide-context` (WSL 2 automatically forwards localhost to Windows).
4.  **Tool Execution**:
    *   Server detects if a requested file path is a Windows path or a WSL path.
    *   If **Windows**: Executes native Node.js tools.
    *   If **WSL**: Uses a "Bridge" to execute commands via `wsl.exe`.

## Step 1: Implementation of WSL Bridge (`server/src/utils/wslBridge.ts`)

We will create a utility module to handle path translation and command execution.

### Features:
1.  **`isWSLPath(path: string)`**: Detects if a path is Linux-like (starts with `/`).
2.  **`resolveWindowsPath(wslPath: string)`**: Converts WSL path (`/home/user/project`) to Windows UNC path (`\\wsl$\Ubuntu\home\user\project`) for direct `fs` access from Windows.
3.  **`execWSL(command: string, args: string[])`**: Wraps command execution.
    *   Example: `execWSL('rg', ['pattern', '/home/user/file'])` -> Spawns `wsl.exe rg pattern /home/user/file`.

## Step 2: Update Tool Implementations

We need to modify the existing tools in `server/src/utils/tools/core/` to support the bridge.

### 1. `ripgrep.ts`
*   **Current**: Spawns `rg` directly.
*   **Change**: Check `isWSLPath(searchPath)`.
    *   If true: Spawn `wsl.exe` with arguments `['rg', ...args]`.
    *   Else: Keep existing behavior.

### 2. `glob.ts`
*   **Current**: Uses `glob` library on local filesystem.
*   **Change**:
    *   If target is WSL, convert path using `resolveWindowsPath` to `\\wsl$\...`.
    *   Node.js `fs` and `glob` can read UNC paths natively on Windows!
    *   *Note*: Performance might be slightly slower than native, but much simpler than parsing `ls -R` output from WSL.

### 3. `readFile.ts` / `createFile.ts` / `editFile.ts`
*   **Current**: Uses `fs.promises`.
*   **Change**:
    *   Use `resolveWindowsPath` to convert any `/home/...` paths to `\\wsl$\...`.
    *   Standard `fs` operations will work transparently.

## Step 3: Server Binding

Ensure `server/src/index.ts` binds to all interfaces to guarantee WSL visibility.

```typescript
// In server/src/index.ts
server.listen(3001, '0.0.0.0', () => { ... })
```

## Step 4: Configuration

*   **Auto-detection**: The bridge will attempt to detect the default WSL distribution using `wsl.exe --list`.
*   **Override**: Allow the VS Code extension to send a `wslDistro` parameter in its initialization handshake if a specific distro is needed.

## Summary of Work

1.  Create `server/src/utils/wslBridge.ts`.
2.  Refactor `ripgrep.ts`, `glob.ts`, and file system tools to use the bridge.
3.  Verify `server.listen` uses `0.0.0.0`.
