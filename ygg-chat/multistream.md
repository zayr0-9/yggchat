# Multi-Stream Architecture Plan

## Overview

This document outlines the implementation plan for supporting parallel streaming states in the chat client. Currently, the application uses a single global `StreamState` object under `chat.streaming`, which means all generations share the same buffers, events, and flags. This prevents users from having multiple concurrent generations (e.g., on different branches or from subagent tool executions).

The goal is to promote streaming state to a **keyed-by-streamId** structure while maintaining backward compatibility and supporting hierarchical subagent streams.

---

## Current Architecture

### State Shape ([chatTypes.ts](client/ygg-chat-r/src/features/chats/chatTypes.ts))

```typescript
export interface StreamState {
  active: boolean
  buffer: string
  thinkingBuffer: string
  toolCalls: ToolCall[]
  events: StreamEvent[]
  messageId: MessageId | null
  error: string | null
  finished: boolean
  streamingMessageId: MessageId | null
}
```

### Current Location in ChatState

```typescript
export interface ChatState {
  // ...
  streaming: StreamState  // Single global instance
  // ...
}
```

### Problems with Current Approach

1. **Single Buffer Collision**: All generations write to the same `buffer`/`thinkingBuffer`
2. **Navigation Hijacking**: `streamCompleted` updates `currentPath`, switching user's view unexpectedly
3. **No Subagent Support**: Tool-spawned generations cannot run independently
4. **No Parallel Branch Exploration**: User cannot have AI generate on multiple branches simultaneously

---

## Proposed Architecture

### 1. New State Shape

#### StreamState (Enhanced)

```typescript
// Keep the per-stream state mostly unchanged, but add lineage metadata
export interface StreamState {
  // Existing fields
  active: boolean
  buffer: string
  thinkingBuffer: string
  toolCalls: ToolCall[]
  events: StreamEvent[]
  messageId: MessageId | null
  error: string | null
  finished: boolean
  streamingMessageId: MessageId | null

  // New: Lineage metadata for subagent support
  parentStreamId?: string        // If spawned from another stream
  rootMessageId?: MessageId      // The message whose branch this stream belongs to
  originMessageId?: MessageId    // The message that triggered this subagent/tool-run
  branchId?: string              // Optional disambiguator for branches sharing a root

  // New: Stream metadata
  createdAt: string              // ISO timestamp for ordering/cleanup
  streamType: 'primary' | 'subagent' | 'tool' | 'branch'
}
```

#### StreamingRootState (New Container)

```typescript
export interface StreamStateById {
  [streamId: string]: StreamState
}

export interface StreamingRootState {
  // Active stream IDs (in-flight)
  activeIds: string[]

  // All stream states keyed by ID
  byId: StreamStateById

  // Tracks the "primary" stream for the current view (optional)
  primaryStreamId: string | null

  // Last completed stream for bookkeeping
  lastCompletedId: string | null
}
```

#### Updated ChatState

```typescript
export interface ChatState {
  // ...
  streaming: StreamingRootState  // Changed from StreamState
  // ...
}
```

### 2. Stream ID Generation Strategy

Stream IDs should be:
- **Stable**: Same stream should have same ID across dispatch cycles
- **Unique**: No collision between concurrent streams
- **Traceable**: Easy to debug and associate with messages

**Recommended approach:**

```typescript
// Primary streams: Use a UUID generated at sendingStarted
const streamId = crypto.randomUUID()  // e.g., "550e8400-e29b-41d4-a716-446655440000"

// Subagent streams: Prefix with parent for traceability
const subagentStreamId = `${parentStreamId}:sub:${crypto.randomUUID().slice(0, 8)}`
// e.g., "550e8400-e29b-41d4-a716-446655440000:sub:a1b2c3d4"

// Tool-spawned streams: Include tool call ID
const toolStreamId = `tool:${toolCallId}:${crypto.randomUUID().slice(0, 8)}`
```

---

## Implementation Plan

### Phase 1: Core State Infrastructure

#### 1.1 Update Types ([chatTypes.ts](client/ygg-chat-r/src/features/chats/chatTypes.ts))

Add new interfaces:

```typescript
// Add to chatTypes.ts

export type StreamType = 'primary' | 'subagent' | 'tool' | 'branch'

export interface StreamLineage {
  parentStreamId?: string
  rootMessageId?: MessageId
  originMessageId?: MessageId
  branchId?: string
}

export interface StreamState {
  // ... existing fields ...

  // Lineage
  lineage: StreamLineage

  // Metadata
  createdAt: string
  streamType: StreamType
}

export interface StreamStateById {
  [streamId: string]: StreamState
}

export interface StreamingRootState {
  activeIds: string[]
  byId: StreamStateById
  primaryStreamId: string | null
  lastCompletedId: string | null
}
```

#### 1.2 Helper Functions

```typescript
// utils/streamHelpers.ts

export const createEmptyStreamState = (
  streamType: StreamType = 'primary',
  lineage: StreamLineage = {}
): StreamState => ({
  active: false,
  buffer: '',
  thinkingBuffer: '',
  toolCalls: [],
  events: [],
  messageId: null,
  error: null,
  finished: false,
  streamingMessageId: null,
  lineage,
  createdAt: new Date().toISOString(),
  streamType,
})

export const generateStreamId = (type: StreamType, context?: {
  parentStreamId?: string
  toolCallId?: string
}): string => {
  const uuid = crypto.randomUUID()

  switch (type) {
    case 'subagent':
      return context?.parentStreamId
        ? `${context.parentStreamId}:sub:${uuid.slice(0, 8)}`
        : `sub:${uuid}`
    case 'tool':
      return context?.toolCallId
        ? `tool:${context.toolCallId}:${uuid.slice(0, 8)}`
        : `tool:${uuid}`
    case 'branch':
      return `branch:${uuid}`
    default:
      return uuid
  }
}
```

### Phase 2: Reducer Updates

#### 2.1 Initial State ([chatSlice.ts](client/ygg-chat-r/src/features/chats/chatSlice.ts))

```typescript
const makeInitialState = (): ChatState => ({
  // ...
  streaming: {
    activeIds: [],
    byId: {},
    primaryStreamId: null,
    lastCompletedId: null,
  },
  // ...
})
```

#### 2.2 Action Payloads

All streaming-related actions need to include `streamId`:

```typescript
// New action payload interfaces
interface StreamActionPayload {
  streamId: string
}

interface SendingStartedPayload extends StreamActionPayload {
  streamType?: StreamType
  lineage?: StreamLineage
}

interface StreamChunkPayload extends StreamActionPayload {
  chunk: StreamChunk
}

interface StreamCompletedPayload extends StreamActionPayload {
  messageId: MessageId
  updatePath?: boolean  // NEW: Controls whether to update currentPath
}

interface StreamingAbortedPayload extends StreamActionPayload {
  error?: string
}
```

#### 2.3 Reducer Logic

```typescript
// chatSlice.ts reducers

sendingStarted: (state, action: PayloadAction<SendingStartedPayload>) => {
  const { streamId, streamType = 'primary', lineage = {} } = action.payload

  // Create new stream state
  state.streaming.byId[streamId] = {
    active: true,
    buffer: '',
    thinkingBuffer: '',
    toolCalls: [],
    events: [],
    messageId: null,
    error: null,
    finished: false,
    streamingMessageId: null,
    lineage,
    createdAt: new Date().toISOString(),
    streamType,
  }

  // Add to active list (dedupe)
  if (!state.streaming.activeIds.includes(streamId)) {
    state.streaming.activeIds.push(streamId)
  }

  // Set as primary if it's the main stream
  if (streamType === 'primary') {
    state.streaming.primaryStreamId = streamId
  }

  // Legacy: Keep composition.sending in sync for primary streams
  if (streamType === 'primary') {
    state.composition.sending = true
    state.composition.input.content = ''
  }
},

streamChunkReceived: (state, action: PayloadAction<StreamChunkPayload>) => {
  const { streamId, chunk } = action.payload
  const stream = state.streaming.byId[streamId]

  // Fallback to 'default' for backward compatibility
  const targetStream = stream || state.streaming.byId['default']
  if (!targetStream) return

  // All existing chunk handling logic, but operating on targetStream instead of state.streaming
  if (chunk.type === 'reset') {
    targetStream.buffer = ''
    targetStream.thinkingBuffer = ''
    targetStream.toolCalls = []
    targetStream.events = []
    targetStream.error = null
    return
  }

  // ... rest of existing chunk handling logic ...
  // (same as current implementation, but replace state.streaming with targetStream)
},

streamCompleted: (state, action: PayloadAction<StreamCompletedPayload>) => {
  const { streamId, messageId, updatePath = false } = action.payload
  const stream = state.streaming.byId[streamId]

  if (!stream) return

  // Mark stream as complete
  stream.active = false
  stream.finished = true
  stream.messageId = messageId

  // Remove from active list
  state.streaming.activeIds = state.streaming.activeIds.filter(id => id !== streamId)

  // Update last completed
  state.streaming.lastCompletedId = streamId

  // CRITICAL: Only update currentPath if explicitly requested AND conditions are met
  if (updatePath) {
    const shouldUpdatePath =
      state.conversation.currentPath.length === 0 ||
      isOnCurrentBranch(state.conversation, messageId)

    if (shouldUpdatePath) {
      const targetId = messageId
      const exists = state.conversation.messages.some(m => m.id === targetId)
      if (exists) {
        state.conversation.currentPath = buildPathToMessage(state.conversation.messages, targetId)
      }
    }
  }

  // Clear primary if this was the primary stream
  if (state.streaming.primaryStreamId === streamId) {
    state.streaming.primaryStreamId = null
  }

  // Legacy: Keep composition.sending in sync
  if (stream.streamType === 'primary') {
    state.composition.sending = false
  }
},

sendingCompleted: (state, action: PayloadAction<{ streamId: string }>) => {
  const { streamId } = action.payload
  const stream = state.streaming.byId[streamId]

  if (!stream) return

  stream.active = false
  stream.finished = true
  stream.streamingMessageId = null

  // Remove from active list
  state.streaming.activeIds = state.streaming.activeIds.filter(id => id !== streamId)

  // Legacy sync
  if (stream.streamType === 'primary') {
    state.composition.sending = false
    state.composition.imageDrafts = []
  }
},

streamingAborted: (state, action: PayloadAction<StreamingAbortedPayload>) => {
  const { streamId, error = 'Generation aborted' } = action.payload
  const stream = state.streaming.byId[streamId]

  if (!stream) return

  stream.active = false
  stream.error = error
  stream.streamingMessageId = null

  // Remove from active list
  state.streaming.activeIds = state.streaming.activeIds.filter(id => id !== streamId)

  // Legacy sync
  if (stream.streamType === 'primary') {
    state.composition.sending = false
  }
},

// NEW: Garbage collection reducer
streamPruned: (state, action: PayloadAction<{ streamId: string }>) => {
  const { streamId } = action.payload

  // Remove from byId
  delete state.streaming.byId[streamId]

  // Clean up activeIds (should already be removed, but safety)
  state.streaming.activeIds = state.streaming.activeIds.filter(id => id !== streamId)
},
```

### Phase 3: Selector Updates

#### 3.1 Per-Stream Selectors ([chatSelectors.ts](client/ygg-chat-r/src/features/chats/chatSelectors.ts))

```typescript
// Base streaming state selector
export const selectStreamingRoot = createSelector(
  [selectChatState],
  chat => chat.streaming
)

// All active stream IDs
export const selectActiveStreamIds = createSelector(
  [selectStreamingRoot],
  streaming => streaming.activeIds
)

// Check if any stream is active
export const selectIsAnyStreaming = createSelector(
  [selectActiveStreamIds],
  activeIds => activeIds.length > 0
)

// Get stream state by ID
export const selectStreamStateById = (streamId: string) =>
  createSelector(
    [selectStreamingRoot],
    streaming => streaming.byId[streamId] ?? null
  )

// Per-stream selectors (factory pattern for memoization)
export const makeSelectStreamBuffer = (streamId: string) =>
  createSelector(
    [selectStreamingRoot],
    streaming => streaming.byId[streamId]?.buffer ?? ''
  )

export const makeSelectThinkingBuffer = (streamId: string) =>
  createSelector(
    [selectStreamingRoot],
    streaming => streaming.byId[streamId]?.thinkingBuffer ?? ''
  )

export const makeSelectStreamEvents = (streamId: string) =>
  createSelector(
    [selectStreamingRoot],
    streaming => streaming.byId[streamId]?.events ?? []
  )

export const makeSelectStreamError = (streamId: string) =>
  createSelector(
    [selectStreamingRoot],
    streaming => streaming.byId[streamId]?.error ?? null
  )

export const makeSelectIsStreaming = (streamId: string) =>
  createSelector(
    [selectStreamingRoot],
    streaming => streaming.byId[streamId]?.active ?? false
  )

export const makeSelectStreamToolCalls = (streamId: string) =>
  createSelector(
    [selectStreamingRoot],
    streaming => streaming.byId[streamId]?.toolCalls ?? []
  )

// Primary stream selectors (backward compatibility)
export const selectPrimaryStreamId = createSelector(
  [selectStreamingRoot],
  streaming => streaming.primaryStreamId
)

export const selectPrimaryStreamState = createSelector(
  [selectStreamingRoot, selectPrimaryStreamId],
  (streaming, primaryId) => primaryId ? streaming.byId[primaryId] : null
)

// Legacy selectors that look at primary stream (for backward compatibility)
export const selectStreamBuffer = createSelector(
  [selectPrimaryStreamState],
  stream => stream?.buffer ?? ''
)

export const selectThinkingBuffer = createSelector(
  [selectPrimaryStreamState],
  stream => stream?.thinkingBuffer ?? ''
)

export const selectStreamError = createSelector(
  [selectPrimaryStreamState],
  stream => stream?.error ?? null
)

export const selectStreamEvents = createSelector(
  [selectPrimaryStreamState],
  stream => stream?.events ?? []
)

export const selectIsStreaming = createSelector(
  [selectPrimaryStreamState],
  stream => stream?.active ?? false
)

// Subagent/hierarchy selectors
export const selectChildStreams = (parentStreamId: string) =>
  createSelector(
    [selectStreamingRoot],
    streaming => Object.entries(streaming.byId)
      .filter(([, state]) => state.lineage.parentStreamId === parentStreamId)
      .map(([id, state]) => ({ id, ...state }))
  )

export const selectStreamsByOriginMessage = (messageId: MessageId) =>
  createSelector(
    [selectStreamingRoot],
    streaming => Object.entries(streaming.byId)
      .filter(([, state]) => state.lineage.originMessageId === messageId)
      .map(([id, state]) => ({ id, ...state }))
  )
```

### Phase 4: Thunk Updates

#### 4.1 sendMessage Thunk ([chatActions.ts](client/ygg-chat-r/src/features/chats/chatActions.ts))

```typescript
export const sendMessage = createAsyncThunk<
  { messageId: MessageId | null; userMessage: any; streamId: string },  // Add streamId to return
  SendMessagePayload & { streamId?: string },  // Optional streamId in payload
  { state: RootState; extra: ThunkExtraArgument }
>(
  'chat/sendMessage',
  async (
    { conversationId, input, parent, repeatNum, think, retrigger = false, imageConfig, reasoningConfig, cwd, streamId: providedStreamId },
    { dispatch, getState, extra, rejectWithValue, signal }
  ) => {
    // Generate or use provided stream ID
    const streamId = providedStreamId ?? generateStreamId('primary')

    dispatch(chatSliceActions.sendingStarted({
      streamId,
      streamType: 'primary',
      lineage: {
        rootMessageId: parent,
      }
    }))

    // ... existing setup code ...

    try {
      // ... existing streaming loop ...

      // When dispatching chunk events, include streamId:
      dispatch(chatSliceActions.streamChunkReceived({
        streamId,
        chunk,
      }))

      // On completion:
      dispatch(chatSliceActions.streamCompleted({
        streamId,
        messageId,
        updatePath: true,  // Primary streams should update path
      }))

      return { messageId, userMessage, streamId }

    } catch (error) {
      dispatch(chatSliceActions.streamChunkReceived({
        streamId,
        chunk: { type: 'error', error: error.message }
      }))
      return rejectWithValue(error.message)
    }
  }
)
```

#### 4.2 Tool/Subagent Spawned Streams

When a tool call spawns a new generation (e.g., a subagent):

```typescript
// Example: spawning a subagent stream from within tool execution
const spawnSubagentStream = async (
  dispatch: any,
  parentStreamId: string,
  originMessageId: MessageId,
  toolCallId: string,
  config: SubagentConfig
) => {
  const streamId = generateStreamId('subagent', { parentStreamId })

  dispatch(chatSliceActions.sendingStarted({
    streamId,
    streamType: 'subagent',
    lineage: {
      parentStreamId,
      originMessageId,
      rootMessageId: config.branchRootMessageId,
    }
  }))

  // ... execute subagent stream ...

  // On completion, do NOT update path
  dispatch(chatSliceActions.streamCompleted({
    streamId,
    messageId: resultMessageId,
    updatePath: false,  // Subagents should NOT hijack navigation
  }))
}
```

### Phase 5: UI Integration

#### 5.1 Message-Level Stream Binding

Each message card that may show streaming content needs to know its associated `streamId`:

```typescript
// MessageCard.tsx
interface MessageCardProps {
  message: Message
  streamId?: string  // Optional: if this message has an active stream
}

const MessageCard: React.FC<MessageCardProps> = ({ message, streamId }) => {
  // If streamId provided, use per-stream selectors
  const buffer = useAppSelector(
    streamId ? makeSelectStreamBuffer(streamId) : selectStreamBuffer
  )
  const events = useAppSelector(
    streamId ? makeSelectStreamEvents(streamId) : selectStreamEvents
  )
  const isStreaming = useAppSelector(
    streamId ? makeSelectIsStreaming(streamId) : selectIsStreaming
  )

  // ... render with streaming content if active ...
}
```

#### 5.2 Global Streaming Indicators

```typescript
// StreamingIndicator.tsx
const GlobalStreamingIndicator: React.FC = () => {
  const activeIds = useAppSelector(selectActiveStreamIds)
  const isAnyStreaming = activeIds.length > 0

  return isAnyStreaming ? (
    <div className="streaming-indicator">
      {activeIds.length > 1
        ? `${activeIds.length} generations in progress`
        : 'Generating...'}
    </div>
  ) : null
}
```

#### 5.3 Per-Stream UI Components

For subagent/tool cards that need to show their own streaming state:

```typescript
// SubagentCard.tsx
interface SubagentCardProps {
  streamId: string
  toolCallId: string
}

const SubagentCard: React.FC<SubagentCardProps> = ({ streamId, toolCallId }) => {
  const streamState = useAppSelector(selectStreamStateById(streamId))

  if (!streamState) return null

  return (
    <div className="subagent-card">
      <div className="status">
        {streamState.active ? 'Running...' :
         streamState.error ? `Error: ${streamState.error}` :
         'Complete'}
      </div>
      <StreamingContent events={streamState.events} />
      {streamState.lineage.parentStreamId && (
        <span className="parent-link">
          Spawned from: {streamState.lineage.parentStreamId}
        </span>
      )}
    </div>
  )
}
```

### Phase 6: Heimdall Integration

Heimdall is the tree navigation component. Key adjustments:

1. **No Navigation Hijacking**: When a stream completes on a non-focused branch, do NOT change `currentPath`
2. **Visual Indicators**: Show which nodes have active streams
3. **Multi-stream awareness**: Allow clicking a node that's streaming without disrupting other streams

```typescript
// In Heimdall node rendering
const HeimdallNode: React.FC<{ node: ChatNode }> = ({ node }) => {
  // Check if this node has an active stream
  const activeStreams = useAppSelector(
    selectStreamsByOriginMessage(node.id as MessageId)
  )
  const hasActiveStream = activeStreams.some(s => s.active)

  return (
    <div className={cn('heimdall-node', { 'streaming': hasActiveStream })}>
      {node.message}
      {hasActiveStream && <StreamingPulse />}
    </div>
  )
}
```

### Phase 7: Backward Compatibility

To ensure existing code continues to work during migration:

#### 7.1 Default Stream Fallback

```typescript
// In reducer, if streamId not provided, use 'default'
sendingStarted: (state, action: PayloadAction<SendingStartedPayload | undefined>) => {
  const streamId = action.payload?.streamId ?? 'default'
  // ... rest of logic
}
```

#### 7.2 Legacy Selector Mapping

Keep existing selectors working by pointing them at the primary stream:

```typescript
// These selectors remain unchanged in signature but look at primaryStreamId
export const selectStreamBuffer = createSelector(...)  // Already shown above
```

#### 7.3 Gradual Migration

1. **Phase A**: Add infrastructure, but use single 'default' streamId everywhere
2. **Phase B**: Update sendMessage to generate unique streamIds
3. **Phase C**: Add subagent stream support
4. **Phase D**: Update UI components to be multi-stream aware

---

## Edge Cases & Considerations

### Abort Handling

When user aborts:
- If aborting "all": Loop through `activeIds` and abort each
- If aborting specific stream: Only affect that stream's controller

```typescript
const abortStream = (streamId: string) => {
  dispatch(chatSliceActions.streamingAborted({ streamId }))
  // Also signal the abort controller for that stream
  streamControllers.get(streamId)?.abort()
}

const abortAllStreams = () => {
  const state = getState()
  state.chat.streaming.activeIds.forEach(abortStream)
}
```

### Garbage Collection

Finished/errored streams should be pruned after:
1. Their message is fully materialized
2. No UI component needs their state
3. A reasonable timeout (e.g., 30 seconds)

```typescript
// After streamCompleted, schedule cleanup
setTimeout(() => {
  dispatch(chatSliceActions.streamPruned({ streamId }))
}, 30000)
```

### Event Deduplication

Keep existing deduplication logic per-stream:
- Tool calls dedupe by `toolCall.id`
- Tool results dedupe by `tool_use_id`
- Images dedupe by URL

### Memory Limits

Consider adding a max streams limit:

```typescript
const MAX_CONCURRENT_STREAMS = 10

// In sendingStarted
if (state.streaming.activeIds.length >= MAX_CONCURRENT_STREAMS) {
  // Reject or queue the new stream
}
```

---

## Implementation Order

### Milestone 1: Core Infrastructure (1-2 days)
- [ ] Add new types to `chatTypes.ts`
- [ ] Add helper functions for stream ID generation
- [ ] Update `chatSlice.ts` initial state
- [ ] Update reducers with streamId support (use 'default' fallback)

### Milestone 2: Selector Layer (0.5 day)
- [ ] Add per-stream selector factories
- [ ] Keep legacy selectors working via primary stream
- [ ] Add multi-stream utility selectors

### Milestone 3: Thunk Integration (1 day)
- [ ] Update `sendMessage` to generate/propagate streamId
- [ ] Update all `dispatch` calls to include streamId
- [ ] Add subagent stream spawning helpers

### Milestone 4: UI Updates (1-2 days)
- [ ] Update message card to accept optional streamId
- [ ] Add global multi-stream indicator
- [ ] Update Chat.tsx to pass streamIds to children
- [ ] Add per-stream UI for subagent/tool cards

### Milestone 5: Navigation Safety (0.5 day)
- [ ] Gate `currentPath` updates in `streamCompleted`
- [ ] Update Heimdall to show streaming indicators
- [ ] Ensure branch switching doesn't kill other streams

### Milestone 6: Cleanup & Polish (0.5 day)
- [ ] Add garbage collection
- [ ] Add abort handlers for individual streams
- [ ] Test concurrent streams thoroughly
- [ ] Remove 'default' fallback once migration complete

---

## Testing Strategy

### Unit Tests
- Reducer handles multiple concurrent streams correctly
- Selectors return correct per-stream state
- Stream ID generation is unique and traceable

### Integration Tests
- Send two messages in quick succession to different branches
- Subagent spawns stream while parent still streaming
- Abort one stream without affecting others
- Complete stream on non-current branch doesn't switch view

### E2E Tests
- User can watch two branches generate simultaneously
- Tool execution spawns subagent that completes independently
- Switching branches mid-stream preserves other stream's progress

---

## Future Considerations

1. **Stream Priorities**: Allow marking certain streams as higher priority
2. **Rate Limiting**: Prevent too many concurrent API calls
3. **Stream Persistence**: Optionally save stream state to IndexedDB for recovery
4. **Cross-Tab Coordination**: Share stream state via BroadcastChannel
5. **Server-Side Correlation**: Have server return streamId for correlation
