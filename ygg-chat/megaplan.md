# Implementation Plan: Local-Only Storage Mode for Ygg-Chat

## Overview

This plan implements optional local-only storage mode, allowing users to choose whether conversations and projects are stored in the cloud (Supabase) or only locally (SQLite in Electron mode). AI inference continues to use cloud providers - only metadata storage is local.

**Key Architecture:** Hybrid approach where local storage applies to conversations/messages/projects, while AI generation proxies through cloud APIs.

---

## Implementation Phases

### PHASE 1: Local Chat Routes (2-3 hours)

**Objective:** Replicate server chat logic in electronChat.ts for local message generation.

**Files to Modify:**
- [client/ygg-chat-r/electron/electronChat.ts](client/ygg-chat-r/electron/electronChat.ts) - NEW implementation
- [client/ygg-chat-r/electron/localServer.ts](client/ygg-chat-r/electron/localServer.ts) - Mount routes

**Key Implementation:**

1. **Create POST /conversations/:id/messages route** in electronChat.ts:
   - Parse request (content, messages, modelName, provider, systemPrompt, think, selectedFiles)
   - Validate conversation exists in local DB
   - Setup SSE streaming response
   - Create user message in local DB (unless retrigger)
   - **Proxy AI generation to Railway server** (keeps inference on cloud)
   - Stream SSE events to client while accumulating content
   - Save final assistant message to local DB
   - Return complete message

2. **Mount routes** in localServer.ts:
   ```typescript
   import electronChatRouter from './electronChat.js'
   app.use('/api/local/chat', electronChatRouter)
   ```

**Dependencies:**
- `uuid` - Message ID generation
- `node-fetch` or built-in fetch - Proxy requests to Railway

**Critical Pattern:**
The local server acts as a **proxy + persistence layer**:
- Forwards AI generation requests to Railway API
- Intercepts SSE stream responses
- Saves messages to local SQLite
- Re-emits events to client

**Validation:**
- Send message in local conversation → verify SSE streaming works
- Check local DB → verify messages saved
- Network tab → confirm no direct Supabase writes

---

### PHASE 2: Local CRUD Endpoints (1-2 hours)

**Objective:** Add full CRUD for local-only projects, conversations, and messages.

**Files to Modify:**
- [client/ygg-chat-r/electron/localServer.ts](client/ygg-chat-r/electron/localServer.ts)

**Endpoints to Add:**

**Conversations:**
- `GET /api/local/conversations?userId=xxx` - Fetch local conversations
- `POST /api/local/conversations` - Create (auto-set storage_mode='local')
- `PATCH /api/local/conversations/:id` - Update title
- `DELETE /api/local/conversations/:id` - Delete

**Messages:**
- `GET /api/local/conversations/:id/messages` - Fetch messages
- `PUT /api/local/messages/:id` - Update message content
- `DELETE /api/local/messages/:id` - Delete message

**Projects:** (Already has POST /api/local/projects)
- Verify existing endpoint sets storage_mode='local'

**Database Statements to Add:**
```typescript
updateMessage: db.prepare(`UPDATE messages SET content = ?, note = ?, content_blocks = ? WHERE id = ?`)
updateConversationTitle: db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`)
getLocalConversations: db.prepare(`SELECT * FROM conversations WHERE user_id = ? AND storage_mode = 'local' ORDER BY updated_at DESC`)
```

**Validation:**
- Test CRUD via Postman or curl
- Verify storage_mode='local' enforced
- Confirm cloud API never called

---

### PHASE 3: Client Routing Logic (2-3 hours)

**Objective:** Route operations to local or cloud API based on storage_mode.

**Files to Modify:**
- [client/ygg-chat-r/src/utils/api.ts](client/ygg-chat-r/src/utils/api.ts) - Add local API helpers
- [client/ygg-chat-r/src/features/conversations/conversationActions.ts](client/ygg-chat-r/src/features/conversations/conversationActions.ts) - Update thunks
- [client/ygg-chat-r/src/features/projects/projectActions.ts](client/ygg-chat-r/src/features/projects/projectActions.ts) - Update thunks

**Key Changes:**

1. **Add Local API Client** (api.ts):
   ```typescript
   export const LOCAL_API_BASE = 'http://127.0.0.1:3002/api'

   export function shouldUseLocalApi(storageMode?: StorageMode, environment?: string): boolean {
     return storageMode === 'local' && environment === 'electron'
   }

   export const localApi = {
     get: <T>(endpoint: string) => fetch(`${LOCAL_API_BASE}${endpoint}`).then(r => r.json()),
     post: <T>(endpoint: string, data?: any) => ...,
     patch: <T>(endpoint: string, data?: any) => ...,
     delete: <T>(endpoint: string) => ...
   }
   ```

2. **Update fetchConversations** thunk:
   - In Electron mode: Fetch both cloud and local in parallel
   - Merge arrays and sort by updated_at
   - In web mode: Cloud only

3. **Update createConversation** thunk:
   - Add `storageMode` parameter
   - Infer from project if not provided
   - Route to `localApi.post('/local/conversations', ...)` or cloud API
   - **Only sync to dualSync for cloud mode**

4. **Update deleteConversation** thunk:
   - Infer storage_mode from Redux state
   - Route to appropriate API
   - Only sync deletion for cloud mode

5. **Update updateConversation, updateSystemPrompt, updateContext** similarly

6. **Repeat pattern for projectActions.ts**

**Validation:**
- Create local conversation → verify calls 127.0.0.1:3002
- Create cloud conversation → verify calls Railway
- Fetch conversations → verify merged list in Electron
- Delete operations → verify correct API called

---

### PHASE 4: DualSync Skip Logic (30 minutes)

**Objective:** Prevent local-only records from syncing backward to cloud.

**Files to Modify:**
- [client/ygg-chat-r/src/lib/sync/dualSyncManager.ts](client/ygg-chat-r/src/lib/sync/dualSyncManager.ts)

**Changes:**

1. **Add storage_mode check in enqueue()** (line ~112):
   ```typescript
   enqueue(operation: Omit<SyncOperation, 'id' | 'retryCount' | 'timestamp'>): void {
     if (!this.enabled) return

     // Skip local-only records
     if (operation.data?.storage_mode === 'local') {
       console.log('[DualSync] Skipping local-only record:', operation.type, operation.data.id)
       return
     }

     // ... existing queue logic
   }
   ```

2. **Add checks in convenience methods**:
   ```typescript
   syncProject(projectData: any, action: 'create' | 'update' | 'delete' = 'create'): void {
     if (projectData?.storage_mode === 'local') return
     this.enqueue({ type: 'project', action, data: projectData })
   }

   syncConversation(conversationData: any, action: 'create' | 'update' | 'delete' = 'create'): void {
     if (conversationData?.storage_mode === 'local') return
     this.enqueue({ type: 'conversation', action, data: conversationData })
   }
   ```

**Validation:**
- Create local project → check dualSync.getStatus() queue is empty
- Create cloud project → verify queue processes
- Monitor console logs → "Skipping local-only record" appears

---

### PHASE 5: UI Components (2-3 hours)

**Objective:** Add storage mode selection toggles and visual indicators.

**Files to Modify:**
- [client/ygg-chat-r/src/containers/ConversationPage.tsx](client/ygg-chat-r/src/containers/ConversationPage.tsx) - Conversation creation
- [client/ygg-chat-r/src/containers/sideBar.tsx](client/ygg-chat-r/src/containers/sideBar.tsx) - List badges
- [client/ygg-chat-r/src/containers/EditProject.tsx](client/ygg-chat-r/src/containers/EditProject.tsx) - Project form

**UI Elements to Add:**

1. **Storage Mode Toggle** (conversation/project creation dialogs):
   ```tsx
   {environment === 'electron' && (
     <div className="storage-mode-selector">
       <label>Storage Location:</label>
       <label>
         <input type="radio" value="cloud" checked={storageMode === 'cloud'}
                onChange={e => setStorageMode(e.target.value)} />
         Cloud (synced to Supabase)
       </label>
       <label>
         <input type="radio" value="local" checked={storageMode === 'local'}
                onChange={e => setStorageMode(e.target.value)} />
         Local Only (device storage)
       </label>
     </div>
   )}
   ```

2. **Badges in Conversation List**:
   ```tsx
   {conversation.storage_mode === 'local' && (
     <span className="badge badge-local">Local</span>
   )}
   ```

3. **Filter Buttons** (sidebar):
   ```tsx
   const [filter, setFilter] = useState<'all' | 'cloud' | 'local'>('all')
   const filtered = conversations.filter(c =>
     filter === 'all' || c.storage_mode === filter
   )
   ```

**Styling:**
```css
.badge-local { background: #4caf50; color: white; }
.badge-cloud { background: #2196f3; color: white; }
```

**Validation:**
- Toggle appears in Electron mode only
- Badges display correctly
- Filters work as expected
- Default to cloud mode

---

### PHASE 6: Message Streaming (1 hour)

**Objective:** Wire up client chat interface to use local endpoint for local conversations.

**Files to Modify:**
- [client/ygg-chat-r/src/features/chats/chatActions.ts](client/ygg-chat-r/src/features/chats/chatActions.ts) - sendMessage thunk

**Changes:**

1. **Route streaming endpoint** based on storage_mode:
   ```typescript
   const conversation = getState().conversations.items.find(c => c.id === conversationId)
   const isLocal = conversation?.storage_mode === 'local'

   const endpoint = isLocal
     ? `/local/chat/conversations/${conversationId}/messages`
     : `/conversations/${conversationId}/messages`

   const baseUrl = isLocal ? LOCAL_API_BASE : API_BASE

   const response = await fetch(`${baseUrl}${endpoint}`, {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       ...(isLocal ? {} : { Authorization: `Bearer ${auth.accessToken}` })
     },
     body: JSON.stringify({ content, messages, modelName, ... })
   })
   ```

2. **SSE parsing remains the same** (both endpoints return identical format)

3. **Message updates route appropriately**:
   - Local: `localApi.put('/local/messages/:id', ...)`
   - Cloud: `api.put('/messages/:id', ...)` + dualSync

**Validation:**
- Send message in local conversation → Network tab shows 127.0.0.1:3002
- Send message in cloud conversation → Network tab shows Railway URL
- Streaming works identically for both modes

---

### PHASE 7: Edge Cases & Validation (1-2 hours)

**Edge Cases to Handle:**

1. **Local conversation without project** - Already supported (projectId can be null)

2. **Mixing storage modes** - Add validation:
   ```typescript
   // In createConversation
   if (projectId && storageMode) {
     const project = getState().projects.projects.find(p => p.id === projectId)
     if (project && project.storage_mode !== storageMode) {
       return rejectWithValue('Storage mode must match project')
     }
   }
   ```

3. **Server-side validation** - Add to server routes:
   ```typescript
   // server/src/routes/conversations.ts
   if (storageMode === 'local') {
     return res.status(400).json({
       error: 'Local-only records should use /local/ endpoints'
     })
   }
   ```

4. **Attachments in local mode** - Handle in electronChat.ts:
   - Decode base64 attachments
   - Save to `/data/uploads` folder
   - Insert into local attachments table
   - Link to message

5. **Tool calls** - No changes needed (already works via `/api/tools/execute`)

6. **Error handling**:
   - "Local server unavailable" when 127.0.0.1:3002 unreachable
   - "Storage mode mismatch" validation errors
   - "Web mode doesn't support local storage" message

**Testing Checklist:**
- [ ] Create local project/conversation in Electron
- [ ] Create cloud project/conversation in Electron
- [ ] Send messages in both modes
- [ ] Edit/delete operations work correctly
- [ ] Attachments work in local mode
- [ ] Tool calls work in local mode
- [ ] Filter and badges display properly
- [ ] Web mode doesn't show local toggles
- [ ] No Supabase calls for local-only records (Network tab)
- [ ] DualSync queue empty for local operations
- [ ] Local data persists after app restart

---

## Critical Files Reference

### Phase 1-2 (Backend):
- [client/ygg-chat-r/electron/electronChat.ts](client/ygg-chat-r/electron/electronChat.ts) - **Main implementation**
- [client/ygg-chat-r/electron/localServer.ts](client/ygg-chat-r/electron/localServer.ts) - Routes and endpoints
- [server/src/routes/chat.ts](server/src/routes/chat.ts) - **Reference implementation**

### Phase 3-4 (Client Logic):
- [client/ygg-chat-r/src/utils/api.ts](client/ygg-chat-r/src/utils/api.ts) - API routing
- [client/ygg-chat-r/src/features/conversations/conversationActions.ts](client/ygg-chat-r/src/features/conversations/conversationActions.ts) - **Main routing logic**
- [client/ygg-chat-r/src/features/projects/projectActions.ts](client/ygg-chat-r/src/features/projects/projectActions.ts) - Project routing
- [client/ygg-chat-r/src/lib/sync/dualSyncManager.ts](client/ygg-chat-r/src/lib/sync/dualSyncManager.ts) - Skip logic

### Phase 5-6 (Frontend):
- [client/ygg-chat-r/src/containers/ConversationPage.tsx](client/ygg-chat-r/src/containers/ConversationPage.tsx) - Creation UI
- [client/ygg-chat-r/src/containers/sideBar.tsx](client/ygg-chat-r/src/containers/sideBar.tsx) - List UI
- [client/ygg-chat-r/src/containers/EditProject.tsx](client/ygg-chat-r/src/containers/EditProject.tsx) - Project UI
- [client/ygg-chat-r/src/features/chats/chatActions.ts](client/ygg-chat-r/src/features/chats/chatActions.ts) - Streaming

### Type Definitions:
- [shared/types.ts](shared/types.ts) - StorageMode type

---

## Key Design Decisions

1. **Hybrid Architecture**: Local storage for metadata, cloud for AI inference
   - Rationale: Keeps AI logic centralized while giving data storage control
   - Implementation: electronChat.ts proxies to Railway for generation

2. **Dual-Source Fetching**: Merge cloud + local data in Electron mode
   - Rationale: Seamless UX regardless of storage mode
   - Implementation: Parallel fetch in thunks, merge and sort by timestamp

3. **Storage Mode Inheritance**: Conversations inherit from project
   - Rationale: Prevents mixed-mode confusion
   - Implementation: Validation in createConversation thunk

4. **No Backwards Sync**: Local-only records never touch Supabase
   - Rationale: Privacy and offline capability
   - Implementation: Early return in dualSync.enqueue()

5. **Web Mode Restrictions**: Local storage only in Electron
   - Rationale: SQLite not available in browser
   - Implementation: Conditional UI rendering based on environment

---

## Implementation Order

Follow phases **sequentially** as each builds on the previous:

1. Phase 1 (2-3h) → Local chat routes enable message generation
2. Phase 2 (1-2h) → CRUD endpoints enable full data management
3. Phase 3 (2-3h) → Client routing wires everything together
4. Phase 4 (30m) → Skip logic prevents cloud pollution
5. Phase 5 (2-3h) → UI makes feature accessible
6. Phase 6 (1h) → Streaming completes the flow
7. Phase 7 (1-2h) → Edge cases and polish

**Total: 10-16 hours**

---

## Success Criteria

✅ **Local Mode Works:**
- Create local conversation → no Supabase writes
- Send messages → streams from local endpoint
- Data persists in local SQLite only

✅ **Cloud Mode Unchanged:**
- Existing behavior preserved
- DualSync continues working
- No breaking changes

✅ **Hybrid Mode:**
- Electron shows merged conversation list
- Filters work correctly
- Storage mode clear from UI badges

✅ **Quality:**
- No errors in console
- Network tab confirms routing
- All tests pass

---

## Future Enhancements (Out of Scope)

- Promote local → cloud migration
- Offline queue with retry
- Local AI providers (Ollama direct integration)
- Encryption at rest (SQLCipher)
- Export/import backup functionality
