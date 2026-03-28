# Hermes-backed branching mode

## Core invariant

In Hermes-backed mode, Ygg owns the conversation tree while Hermes owns one runtime session per branch lineage.

That means:

- Ygg remains the source of truth for message nodes, branch selection, persistence, and streaming UI state.
- Hermes sessions are backend runtime state attached to branch lineages.
- `streamId`, `messageId`, and `sessionId` are distinct and must stay distinct.

## Hard rules

### Continue current branch

When the user sends on the tip of the currently selected path:

- resolve the nearest valid Hermes session from that lineage
- continue that session with `session/prompt`

### Edit a historical message

Historical edits are never in-place mutations.

Instead:

- create a new Ygg branch
- resolve the nearest valid lineage session for the branch anchor
- fork that session
- prompt the fork with the edited content

### Retry / regenerate

Retries are also branch creation.

Instead of mutating or reusing the original branch in-place:

- branch from the parent user node
- fork the source lineage session
- prompt the fork again

### Explicit branch action

Explicit branch actions follow the same rule:

- fork lineage session
- prompt forked session
- persist the resulting assistant message with the new session id

## Session resolution rules

### Continuation

Prefer, in order:

1. explicitly provided session id
2. nearest lineage session id
3. conversation-level cached session id

### Branch / fork

Prefer, in order:

1. nearest lineage session id
2. explicitly provided session id

Important: branch execution must **not** silently fall back to a conversation-global session when no valid lineage session exists. If no valid fork source exists, the run starts as a fresh session instead of reusing an unrelated branch session.

## Permission handling

Hermes ACP permission requests are bridged through Ygg's existing permission UX.

- backend emits a permission request event over the Hermes SSE stream
- renderer uses the existing tool permission dialog / allow-all toggle
- renderer posts the decision back to the local Electron server
- Electron resolves the pending ACP permission request

## Rule statement

> In Hermes-backed mode, Ygg treats all message edits, retries, and alternate continuations as branch creation operations. Ygg owns the conversation tree; Hermes owns one runtime session per branch lineage. Continuing a branch reuses its Hermes session. Creating a branch forks the nearest valid Hermes session and continues on the fork. No historical message is mutated in place.
