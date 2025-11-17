# Dual-Sync Implementation Plan for Electron Mode

## Overview
Sync data between Railway server (remote/authoritative) and local SQLite database in Electron mode. Railway handles AI generation; local SQLite provides offline access and backup.

**Strategy**: Railway-first, write-through sync (not bidirectional)

---

## Phase 1: Local Server Infrastructure (~4-6 hours)

### 1.1 Create Embedded Express Server
**New File**: `electron/localServer.ts`
- Import server routes and models from `ygg-chat/server/src/`
- Initialize SQLite database in Electron app data directory (`app.getPath('userData')`)
- Run on `localhost:3002` (separate from dev server port 3001)
- Apply same schema as production (`db.ts` migrations)

### 1.2 Update Electron Main Process
**Modify**: `electron/main.ts`
- Import and start local server on `app.whenReady()`
- Gracefully stop server on `app.on('before-quit')`
- Handle port conflicts with retry logic
- Pass database path to local server

---

## Phase 2: Sync Layer (~3-4 hours)

### 2.1 Create Sync Manager
**New File**: `src/lib/sync/syncManager.ts`
```typescript
interface SyncOperation {
  id: string
  type: 'project' | 'conversation' | 'message' | 'attachment'
  action: 'create' | 'update' | 'delete'
  data: any
  retryCount: number
  timestamp: number
}

class SyncManager {
  private queue: SyncOperation[] = []
  private localApiBase = 'http://localhost:3002/api'

  async syncToLocal(operation: SyncOperation): Promise<void>
  async processQueue(): Promise<void>
  logSyncError(operation: SyncOperation, error: Error): void
}
```

### 2.2 Implement Sync Operations
**New File**: `src/lib/sync/operations.ts`
- `syncProject(projectData)` - Replicate project to local DB
- `syncConversation(conversationData)` - Replicate conversation
- `syncMessage(messageData)` - Replicate message with all metadata
- `syncAttachment(attachmentData)` - Download binary, store locally
- `syncProviderCost(costData)` - Replicate usage tracking

---

## Phase 3: API Layer Integration (~6-8 hours)

### 3.1 Create Dual-API Wrapper
**New File**: `src/utils/dualApi.ts`
```typescript
import { api as railwayApi } from './api'
import { environment } from './api'

const LOCAL_API_BASE = 'http://localhost:3002/api'

export const dualApi = {
  async post<T>(endpoint: string, token: string | null, data: any): Promise<T> {
    // 1. Execute on Railway (authoritative)
    const result = await railwayApi.post<T>(endpoint, token, data)

    // 2. Replicate to local (fire-and-forget)
    if (environment === 'electron') {
      syncManager.enqueue({
        type: getResourceType(endpoint),
        action: 'create',
        data: result
      })
    }

    return result
  },

  async patch<T>(endpoint: string, token: string | null, data: any): Promise<T>,
  async delete<T>(endpoint: string, token: string | null): Promise<T>
}
```

### 3.2 Modify Project Actions
**Modify**: `src/features/projects/projectActions.ts`
```typescript
export const createProject = createAsyncThunk(
  'projects/create',
  async (projectData, { extra }) => {
    const result = await dualApi.post('/projects', token, projectData)
    // Local sync happens automatically in dualApi
    return result
  }
)
```

### 3.3 Modify Conversation Actions
**Modify**: `src/features/conversations/conversationActions.ts`
- Wrap `createConversation` with dual sync
- Wrap `updateConversation` with dual sync
- Wrap `deleteConversation` with dual sync
- Wrap `updateSystemPrompt`, `updateContext`, `updateResearchNote`

### 3.4 Modify Message Actions
**Modify**: `src/features/chats/chatActions.ts`
- Special handling for streaming (see Phase 4)
- Wrap `updateMessage` with dual sync
- Wrap `deleteMessage` with dual sync

---

## Phase 4: Streaming Message Sync (~4-6 hours)

### 4.1 Handle Complete SSE Event
**Modify**: `src/features/chats/chatActions.ts` (sendMessage thunk)
```typescript
// Inside SSE event loop
if (chunk.type === 'complete') {
  dispatch(chatSliceActions.messageAdded(chunk.message))
  updateMessageCache(queryClient, conversationId, chunk.message)

  // NEW: Sync complete message to local
  if (environment === 'electron') {
    // Sync user message first (if not already synced)
    if (userMessage) {
      await syncManager.syncMessage(userMessage)
    }
    // Sync assistant message with all metadata
    await syncManager.syncMessage(chunk.message)

    // Sync provider cost if available
    if (chunk.cost) {
      await syncManager.syncProviderCost(chunk.cost)
    }
  }
}
```

### 4.2 Attachment Replication
**New File**: `src/lib/sync/attachmentSync.ts`
```typescript
async function syncAttachmentToLocal(attachment: Attachment): Promise<void> {
  // 1. Download from Railway CDN
  const response = await fetch(attachment.url)
  const blob = await response.blob()

  // 2. Upload to local server
  const formData = new FormData()
  formData.append('file', blob, attachment.filename)
  formData.append('metadata', JSON.stringify({
    id: attachment.id,
    message_id: attachment.message_id,
    // ... other metadata
  }))

  await fetch(`${LOCAL_API_BASE}/attachments/sync`, {
    method: 'POST',
    body: formData
  })
}
```

---

## Phase 5: Environment Configuration (~2-4 hours)

### 5.1 Update Environment Variables
**Modify**: `.env.electron`
```
VITE_ENVIRONMENT=electron
VITE_API_URL=https://your-railway-server.railway.app/api
VITE_LOCAL_API_URL=http://localhost:3002/api
```

### 5.2 User ID Consistency
**Important**: Ensure same user ID between Railway and local
- On first Electron launch, register user with Railway
- Store Railway user ID in local database
- Use this ID for all operations

### 5.3 Build Configuration
**Modify**: `electron-builder.json`
```json
{
  "extraResources": [
    {
      "from": "server/dist",
      "to": "server",
      "filter": ["**/*"]
    }
  ],
  "nativeRebuilds": {
    "buildDependencies": ["better-sqlite3"]
  }
}
```

### 5.4 Local Server Sync Endpoints
**New Routes on Local Server**: `electron/routes/sync.ts`
```typescript
// POST /api/sync/project - Accepts full project object
// POST /api/sync/conversation - Accepts full conversation object
// POST /api/sync/message - Accepts full message object
// POST /api/sync/attachment - Accepts binary + metadata
// DELETE /api/sync/:resource/:id - Soft delete
```

---

## Key Files Summary

### Create New Files:
1. `electron/localServer.ts` - Embedded Express server
2. `electron/routes/sync.ts` - Sync-specific endpoints
3. `src/lib/sync/syncManager.ts` - Queue and coordination
4. `src/lib/sync/operations.ts` - Individual sync operations
5. `src/lib/sync/attachmentSync.ts` - Binary file handling
6. `src/utils/dualApi.ts` - Dual-write wrapper

### Modify Existing Files:
1. `electron/main.ts` - Start/stop local server
2. `electron/preload.ts` - Expose sync status (optional)
3. `src/features/projects/projectActions.ts` - Use dualApi
4. `src/features/conversations/conversationActions.ts` - Use dualApi
5. `src/features/chats/chatActions.ts` - Sync on stream complete
6. `src/utils/api.ts` - Export environment for checks

### Copy/Bundle:
1. Server database schema (`db.ts`) → Electron bundle
2. Server models (`models.ts`) → Electron bundle
3. Shared types already accessible

---

## Important Considerations

### Data Consistency
- **Railway is authoritative** - Local is replica
- **Same UUIDs** - Use Railway-generated IDs locally
- **Eventual consistency** - Local may lag behind Railway
- **No conflict resolution** - Railway always wins

### Error Handling
- **Fire-and-forget sync** - Don't block UI on local failures
- **Retry queue** - Failed syncs retried with backoff
- **Error logging** - Track sync failures for debugging
- **Graceful degradation** - App works if local sync fails

### Performance
- **Async sync** - Don't wait for local write
- **Batch operations** - Group related syncs
- **Selective sync** - Only sync relevant data
- **Compression** - Compress large content before storage

### Security
- **Local server localhost only** - No external access
- **No auth needed locally** - Trust electron process
- **Sanitize data** - Validate before writing to local DB
- **Secure storage** - Use Electron's app data directory

---

## Testing Strategy

1. **Unit tests** for sync operations
2. **Integration tests** for Railway → Local flow
3. **E2E tests** for complete user workflows
4. **Stress tests** for queue handling
5. **Offline tests** for degraded mode

---

## Estimated Total Effort: 20-30 hours

- Phase 1: 4-6 hours (Local server setup)
- Phase 2: 3-4 hours (Sync layer foundation)
- Phase 3: 6-8 hours (API integration)
- Phase 4: 4-6 hours (Streaming sync)
- Phase 5: 2-4 hours (Configuration & polish)
- Testing: 4-6 hours (Additional)

---

## Implementation Progress

- [x] Phase 1: Local Server Infrastructure
  - [x] Create `electron/localServer.ts` - Embedded Express + SQLite server on port 3002
  - [x] Modify `electron/main.ts` - Start/stop lifecycle with graceful shutdown
- [x] Phase 2: Sync Layer
  - [x] Create `src/lib/sync/dualSyncManager.ts` - Queue with retries, status tracking, batch operations
  - [x] Fire-and-forget sync pattern implemented
- [x] Phase 3: API Integration
  - [x] Import dualSync into projectActions.ts, conversationActions.ts, chatActions.ts
  - [x] Sync calls added after create/update/delete operations
- [x] Phase 4: Streaming Message Sync
  - [x] Handle user_message and complete SSE events in sendMessage
  - [x] Handle user_message and complete SSE events in editMessageWithBranching
  - [x] Handle user_message and complete SSE events in sendMessageToBranch
  - [x] Sync provider_cost when available
  - [ ] Attachment replication (deferred - Railway URLs work as-is)
- [x] Phase 5: Environment Configuration
  - [x] Add better-sqlite3, express, cors dependencies
  - [x] Add type definitions (@types/better-sqlite3, @types/express, @types/cors)
  - [x] Configure electron-builder for native module rebuilding
  - [x] Add electron-rebuild for native dependencies
- [ ] Testing & Polish
  - [ ] Run `npm install` to install new dependencies
  - [ ] Test Electron app starts local server on port 3002
  - [ ] Test sync operations fire after Railway API calls
  - [ ] Verify local SQLite database is created and populated

## Quick Start

1. Install dependencies:
   ```bash
   cd ygg-chat/client/ygg-chat-r
   npm install
   ```

2. For Electron builds with native modules:
   ```bash
   npx electron-rebuild
   ```

3. Start Electron dev mode:
   ```bash
   npm run dev:electron
   ```

4. Check local sync server:
   ```bash
   curl http://127.0.0.1:3002/api/health
   # Expected: { "status": "ok", "mode": "local-sync" }
   ```

5. Check sync stats:
   ```bash
   curl http://127.0.0.1:3002/api/sync/stats
   ```

## Files Created/Modified

### Created:
- `electron/localServer.ts` - Embedded Express server with SQLite
- `src/lib/sync/dualSyncManager.ts` - Client-side sync coordinator

### Modified:
- `electron/main.ts` - Local server lifecycle management
- `src/features/projects/projectActions.ts` - Added dualSync calls
- `src/features/conversations/conversationActions.ts` - Added dualSync calls
- `src/features/chats/chatActions.ts` - Added dualSync calls for streaming
- `package.json` - Added server dependencies and build config
