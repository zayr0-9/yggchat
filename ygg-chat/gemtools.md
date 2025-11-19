# GemTools Implementation Plan

## Overview
Implement "Client-side Tool Execution" where the Remote Server (Railway/Web) delegates tool execution to the Local Client (Electron) via a local bridge server.

## Architecture
1. **Remote Server (3003)**: Receives chat request, calls LLM (OpenRouter), generates tool calls.
2. **Client (React)**: Receives tool calls from stream, forwards them to Local Server (3002).
3. **Local Server (3002)**: Executes tools (FS, Terminal) on the local machine, returns results to Client.
4. **Client**: Sends tool results back to Remote Server to continue LLM generation.

## Current Status
- **Remote Server**: `supaChat.ts` and `openrouter.ts` support `executionMode` and tool call streaming.
- **Client**: `chatActions.ts` has logic for `executeLocalTool` and handling `assistantToolCalls` locally.
- **Local Server**: `localServer.ts` exists on port 3002 but **lacks** the `/api/tools/execute` endpoint.

## Implementation Steps (Updated)

### 1. Update Client Configuration (`chatActions.ts`) - ✅ DONE
- **Fix `LOCAL_API_BASE`**: Updated to `http://127.0.0.1:3002/api`.
- **Enable Client Execution**: Set `executionMode` to `'client'`.

### 2. Enhance Local Server (`localServer.ts`) - ✅ DONE
- **Add Endpoint**: `POST /api/tools/execute`.
- **Implement Tools**: Basic FS tools (`read_file`, `create_file`, `edit_file`, `delete_file`, `directory`) implemented using Node.js `fs`.

### 3. Tool Implementation Details (Local) - ✅ DONE
- Tools implemented directly in `localServer.ts`.

## Verification
1. Start Remote Server (3003).
2. Start Local Server (3002).
3. Run Client (Web mode).
4. Send message "List files in current directory".
5. Verify Remote Server sends tool call `directory`.
6. Verify Client sends request to `http://127.0.0.1:3002/api/tools/execute`.
7. Verify Local Server executes and returns file list.
8. Verify Client sends result to Remote Server.
9. Verify Remote Server generates final response.
