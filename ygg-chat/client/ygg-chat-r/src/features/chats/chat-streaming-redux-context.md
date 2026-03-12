# Chat streaming via Redux: current state

This note captures how chat streaming currently works in `ygg-chat-r` before making changes.

## Main idea

Streaming is tracked in Redux under `state.chat.streaming`, not just a single boolean.

There is a newer **multi-stream** model:
- `streaming.byId[streamId]` stores per-stream state
- `streaming.activeIds` stores all active stream IDs
- `streaming.primaryStreamId` points to the current primary stream
- each stream also carries `lineage` metadata so it can be associated with a branch/message

At the same time, the UI still keeps a **legacy compatibility path**:
- `state.chat.composition.sending`
- selectors like `selectSendingState`
- some UI logic still asks "is *anything* streaming?" instead of "is the *current branch view* streaming?"

That mix is the important thing to understand.

---

## Redux state shape

Defined in:
- `src/features/chats/chatTypes.ts`
- initialized in `src/features/chats/chatSlice.ts`

Important pieces:

```ts
state.chat.streaming = {
  activeIds: string[],
  byId: Record<string, StreamState>,
  primaryStreamId: string | null,
  lastCompletedId: string | null,
}
```

Each `StreamState` contains:
- `active`
- `buffer`
- `thinkingBuffer`
- `toolCalls`
- `events`
- `messageId`
- `streamingMessageId`
- `error`
- `finished`
- `streamType` (`primary | subagent | tool | branch`)
- `lineage`

`lineage` can include:
- `parentStreamId`
- `rootMessageId`
- `originMessageId`
- `branchId`

The key branch-related field is usually `lineage.rootMessageId`, which is meant to identify the parent/root message that the stream belongs to.

---

## How streams start

In `chatActions.ts`, send thunks generate a `streamId` and dispatch `chatSliceActions.sendingStarted(...)`.

Examples:
- `sendMessage(...)` uses `generateStreamId('primary')`
- `editMessageWithBranching(...)` uses `generateStreamId('branch')`
- `sendHermesMessage(...)` uses `generateStreamId('primary')`

Typical start payload:

```ts
chatSliceActions.sendingStarted({
  streamId,
  streamType: 'primary',
  lineage: {
    rootMessageId: parent,
  },
})
```

Reducer behavior in `chatSlice.ts`:
- creates `streaming.byId[streamId]`
- marks it `active: true`
- pushes the ID into `streaming.activeIds`
- if `streamType === 'primary'`, sets `streaming.primaryStreamId = streamId`
- for legacy compatibility, also sets `composition.sending = true`

---

## How stream updates arrive

Chunks are handled by `chatSliceActions.streamChunkReceived(...)`.

That reducer updates the target stream in `streaming.byId[streamId]`:
- text chunks append to `buffer`
- reasoning chunks append to `thinkingBuffer`
- tool calls update `toolCalls`
- ordered render data is accumulated in `events`
- `complete` sets `messageId` but intentionally does **not** end the stream yet
- `error` marks that stream inactive and removes it from `activeIds`

Important detail:
- the stream is not considered fully done just because a `complete` chunk arrived
- actual shutdown happens later through `streamCompleted(...)` or `sendingCompleted(...)`

This is because some flows are multi-turn and may keep going after intermediate completion events.

---

## How streams stop

A send thunk eventually dispatches:
- `streamCompleted({ streamId, messageId, updatePath: true })`
- `sendingCompleted({ streamId })`
- and later `streamPruned({ streamId })` after `STREAM_PRUNE_DELAY` (30s)

Reducer behavior:

### `streamCompleted(...)`
- marks the stream inactive
- marks it finished
- stores `messageId`
- removes `streamId` from `activeIds`
- may update `conversation.currentPath`
- clears `primaryStreamId` if needed
- for primary streams, also sets `composition.sending = false`

### `sendingCompleted(...)`
- also marks the stream inactive/finished
- removes it from `activeIds`
- clears `primaryStreamId` if needed
- for primary streams, sets `composition.sending = false`

### `streamPruned(...)`
- removes the old stream entry from `streaming.byId`
- cleanup only; not part of visible "stop streaming" behavior

---

## Abort handling

`chatActions.ts` keeps abort controllers in module-level maps:
- `generationAbortControllersByStream`
- `subagentAbortControllersByStream`

`abortGeneration({ streamId, messageId })`:
- aborts subagent controllers for that stream
- optionally asks server to stop streaming
- aborts local controllers
- dispatches `streamingAborted({ streamId })`
- or `allStreamsAborted()` if no stream ID was provided

Reducer behavior for `streamingAborted(...)`:
- marks that stream inactive
- removes it from `activeIds`
- clears `primaryStreamId` if needed
- sets `composition.sending = false` for primary streams

---

## How Chat.tsx reads streaming state

In `src/containers/Chat.tsx`:

```ts
const sendingState = useAppSelector(selectSendingState)
const currentViewStream = useAppSelector(selectCurrentViewStream)
```

Then it derives a local `streamState` from `currentViewStream`.

### `selectSendingState`
Defined in `chatSelectors.ts`:

```ts
streaming: activeIds.length > 0
```

So `sendingState.streaming` means:
- **any stream anywhere in chat Redux is active**
- not necessarily the stream for the currently selected branch/path

### `selectCurrentViewStream`
Also in `chatSelectors.ts`.

It tries to choose the stream most relevant to the current branch view:
1. find an active stream whose `lineage.rootMessageId` is included in `conversation.currentPath`
2. else return `primaryStreamId` if active
3. else return any active stream
4. else return `null`

This is branch-aware, but it still has global fallbacks.

---

## Why the send button keeps animating after branch switch

In `Chat.tsx` the loading button is controlled by:

```ts
const showGenerationLoadingAnimation =
  sendingState.compacting || sendingState.streaming || sendingState.sending
```

That means the send button animates if:
- compaction is happening, or
- **any stream is active globally**, or
- the legacy primary `sending` flag is true

So even if the user switches to a different branch where the current visible branch should not show streaming:
- `sendingState.streaming` stays true while *some other stream* is active
- the send button continues showing the loading animation

This is the main current mismatch between:
- **branch-aware stream display selection** (`selectCurrentViewStream`)
- **global loading state** (`selectSendingState`)

There is a second contributing factor:
- `selectCurrentViewStream` falls back to primary stream, then to any active stream, so even branch switching may still surface another active stream instead of returning `null`

---

## Current branch switching behavior

Branch selection updates:
- `conversation.currentPath`
- often via `conversationPathSet(...)` / `selectedNodePathSet(...)`
- for example from `handleNodeSelect(...)` in `Chat.tsx`

Switching branch does **not** stop or detach active streams in Redux.
It only changes which branch/path is selected.

So the active stream continues to exist in:
- `streaming.byId`
- `streaming.activeIds`

The current UI issue is not that branch switching fails to mutate stream state. It is that the UI still treats global active streaming as if it belongs to the currently viewed branch.

---

## Important current-state takeaway

Right now the app has two overlapping models:

1. **Global/legacy sending model**
   - `composition.sending`
   - `selectSendingState.streaming = activeIds.length > 0`
   - drives the send button animation

2. **Per-stream / branch-aware model**
   - `streaming.byId`
   - `lineage.rootMessageId`
   - `selectCurrentViewStream`
   - used to decide which stream content to display

These two models are not aligned yet, which is why branch switching can still show the send button as streaming.

---

## Files most relevant for the next planning step

- `src/features/chats/chatTypes.ts`
- `src/features/chats/streamHelpers.ts`
- `src/features/chats/chatSlice.ts`
- `src/features/chats/chatSelectors.ts`
- `src/features/chats/chatActions.ts`
- `src/containers/Chat.tsx`
