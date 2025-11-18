# Build Process Verification & Plan

This document outlines the current Electron build process, identifies necessary adjustments for a robust Windows-only build, and provides a detailed plan for execution.

## Current Build Process Analysis

The current build process (in `package.json`) for Windows is:
`"build:win": "npm run build:electron && npm run build:electron:main && electron-builder --win"`

This breaks down into:
1.  **`npm run build:electron`**: Builds the React frontend using Vite.
    *   `cross-env BUILD_TARGET=electron tsc -b`
    *   `cross-env BUILD_TARGET=electron vite build`
    *   Output: `dist-electron/`

2.  **`npm run build:electron:main`**: Compiles the Electron main process.
    *   `tsc -p electron/tsconfig.json`
    *   Renames `.js` to `.mjs` for ES Module compatibility.
    *   Output: `electron/main.mjs`, `electron/preload.mjs`

3.  **`electron-builder --win`**: Packages the app.
    *   Uses `dist-electron/` (frontend) and `electron/` (main process).
    *   **Crucial Missing Step**: It expects the **server** to be available.
    *   `main.ts` attempts to spawn the server: `path.join(process.resourcesPath, 'server', 'dist', 'index.js')`.
    *   The `server` directory needs to be built and copied into the final package resources.

## Critical Gap: The Server Build

The current `build:win` script **does not build the server**. The Electron app will launch, try to spawn the server from `resources/server/dist/index.js`, and fail because that file won't exist in the packaged app.

**Required Fixes**:
1.  **Build the Server**: We need a `build:server` step that compiles the server TypeScript to JavaScript.
2.  **Copy Server to Resources**: Configure `electron-builder` to include the built server directory in the final executable's resources.
3.  **Native Dependencies**: The server uses `better-sqlite3`. This is a native module.
    *   For a Windows build, `better-sqlite3` must be rebuilt for the Electron version's ABI (Application Binary Interface) OR standard Node ABI if spawned as a separate process (which we are doing).
    *   Since we are spawning `process.execPath` (Electron executable) to run the server script, the server runs **inside Electron's Node environment**.
    *   Therefore, `better-sqlite3` **MUST** be rebuilt for Electron.

## Detailed Implementation Plan

### 1. Create `build:server` Script
We need a script in `package.json` (root or client) to build the server.
*   Command: `cd ../../server && npm run build`
*   The server's `package.json` already has `build: "tsc"`. We need to ensure `tsc` outputs to `server/dist`.

### 2. Update `package.json` Build Scripts
Modify `ygg-chat/client/ygg-chat-r/package.json`:

```json
"scripts": {
  "build:server": "cd ../../server && npm install && npm run build",
  "build:win": "npm run build:server && npm run build:electron && npm run build:electron:main && electron-builder --win"
}
```

### 3. Configure `electron-builder` (Files & Extra Resources)
Update `build` configuration in `package.json` to include the server files.

```json
"build": {
  "extraResources": [
    {
      "from": "../../server/dist",
      "to": "server/dist",
      "filter": ["**/*"]
    },
    {
      "from": "../../server/node_modules",
      "to": "server/node_modules",
      "filter": ["**/*"]
    },
    {
      "from": "../../server/package.json",
      "to": "server/package.json"
    },
    {
      "from": "../../server/src/database",
      "to": "server/src/database",
      "filter": ["**/*.sql", "**/*.txt"] 
    }
  ]
}
```
*Note: Copying `node_modules` is heavy. A better approach is to bundle the server into a single file using `esbuild` or `webpack`, or run `npm install --production` in the output folder. For now, copying is safer to ensure native modules work, but we must ensure `electron-rebuild` runs for the server's dependencies if they are used by Electron.*

**Wait, Correction on Native Modules**:
We are spawning the server using `spawn(process.execPath, [serverPath], ...)`.
*   `process.execPath` is the Electron executable.
*   The server runs in Electron's V8 engine.
*   `better-sqlite3` in `server/node_modules` must be compiled against Electron's headers.

**Action**: Add a `postinstall` or explicit rebuild step for server dependencies targeting Electron.
Or simpler: Use `electron-rebuild` on the server directory before packaging.

### 4. Refined Plan Step-by-Step

1.  **Verify Server Build**: Run `npm run build` in `server/` manually to check output structure (`dist/`).
2.  **Update Client `package.json`**:
    *   Add `build:server` script.
    *   Update `build:win` to include server build.
    *   Update `electron-builder` config (`extraResources`) to copy the built server and its `node_modules`.
3.  **Handle Native Modules**:
    *   Add a script to rebuild server dependencies for Electron: `electron-rebuild -m ../../server` (might need adjustment for path).
4.  **Verify `main.ts` Path**:
    *   Check `path.join(process.resourcesPath, 'server', 'dist', 'index.js')`.
    *   Ensure `extraResources` structure matches this expectation.

## Build Instructions

To build the Windows application:

1.  **Navigate to the Client Directory**:
    ```bash
    cd ygg-chat/client/ygg-chat-r
    ```

2.  **Install Dependencies**:
    Ensure all dependencies are installed for both client and server.
    ```bash
    npm install
    cd ../../server && npm install && cd ../client/ygg-chat-r
    ```

3.  **Rebuild Native Modules**:
    Rebuild `better-sqlite3` for Electron.
    ```bash
    npm run rebuild:server
    ```

4.  **Build for Windows**:
    Run the build script which handles server build, client build, main process compilation, and packaging.
    ```bash
    npm run build:win
    ```

The output installer will be located in `ygg-chat/client/ygg-chat-r/release/`.
