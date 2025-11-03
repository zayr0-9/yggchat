# Claude Code Integration Architecture

## Overview

This document explains how the Claude Agent SDK integration handles multiple IDE instances running with different working directories.

## Problem Statement

When a user has multiple IDE windows open in different folders (e.g., frontend and backend projects), the Claude Code integration needs to:

1. **Maintain separate sessions** for each project context
2. **Track working directory (cwd)** for each conversation
3. **Support resumable conversations** within the same project context
4. **Isolate session state** across projects

## Solution

### Session Key Management

Sessions are stored using a **composite key** that combines both the conversation ID and working directory:

```typescript
sessionKey = `${conversationId}:${cwd}`
```

This ensures that:
- The same `conversationId` in different directories creates separate sessions
- The same `conversationId` in the same directory reuses the existing session
- Multiple IDE instances can operate independently without interference

### Architecture Components

#### 1. CC.ts (`server/src/utils/CC.ts`)

**Key Functions:**

**`startChat(conversationId, userMessage, cwd)`**
- Creates a new Claude Code session for a specific project context
- Parameters:
  - `conversationId`: Unique identifier for the conversation
  - `userMessage`: The user's input message
  - `cwd`: Working directory context (e.g., `/home/user/frontend-app`)
- Operations:
  - Creates composite session key: `conversationId:cwd`
  - Passes `cwd` to SDK query options
  - Captures session ID from init message
  - Validates returned `cwd` matches requested `cwd`

**`resumeChat(conversationId, userMessage, cwd)`**
- Continues an existing conversation in a specific project context
- Automatically calls `startChat` if no session exists for that key
- Parameters: Same as `startChat`
- Operations:
  - Looks up session by composite key
  - Passes session ID to SDK's `resume` option
  - Passes `cwd` to ensure proper context

**`createSessionKey(conversationId, cwd)`**
- Helper function to generate composite session keys
- Returns: `${conversationId}:${cwd}`

#### 2. Session Storage

```typescript
const sessions = new Map<string, string>();
// Key: "conversationId:cwd"
// Value: SDK sessionId
```

**In-memory storage** for MVP. Future enhancements could persist to database.

### SDK Integration Details

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) supports:

1. **Working Directory Parameter**
   ```typescript
   options: {
     cwd: "/path/to/project",  // Specifies working directory
     maxTurns: 10,
     permissionMode: "default"
   }
   ```

2. **Session Resumption**
   ```typescript
   options: {
     cwd: "/path/to/project",
     resume: sessionId,  // Resume existing session
     maxTurns: 10
   }
   ```

3. **Init Message Contains CWD**
   ```typescript
   if (message.type === "system" && message.subtype === "init") {
     console.log(`Connected to: ${message.cwd}`);
   }
   ```

### Data Flow Example

```
User A (IDE Window 1: /home/user/frontend)
├─ conversationId: "conv-123"
├─ cwd: "/home/user/frontend"
├─ Session Key: "conv-123:/home/user/frontend"
└─ SDK Session ID: "sess-abc123"

User B (IDE Window 2: /home/user/backend)
├─ conversationId: "conv-456"
├─ cwd: "/home/user/backend"
├─ Session Key: "conv-456:/home/user/backend"
└─ SDK Session ID: "sess-xyz789"

Internal Storage:
sessions = {
  "conv-123:/home/user/frontend" -> "sess-abc123",
  "conv-456:/home/user/backend" -> "sess-xyz789"
}
```

## Usage

### Basic Usage

```typescript
import { startChat, resumeChat } from './utils/CC';

// Start a new chat
await startChat(
  'my-conversation',
  'Help me understand this code',
  '/home/user/my-project'
);

// Resume the same conversation
await resumeChat(
  'my-conversation',
  'Tell me more about the patterns',
  '/home/user/my-project'
);

// Different project - different session
await startChat(
  'my-conversation',  // Same ID, but different cwd
  'How do I set up this project?',
  '/home/user/other-project'  // Different working directory
);
```

### With Streaming (Future Enhancement)

The current implementation logs all responses to console. Future versions should:

1. Accept `onChunk` callback for streaming
2. Transform SDK responses to chat UI format
3. Stream to client in real-time

```typescript
// Example future API
await startChat(
  conversationId,
  userMessage,
  cwd,
  {
    onChunk: (chunk) => {
      // Send to WebSocket/HTTP response
      ws.send(JSON.stringify(chunk));
    }
  }
);
```

## Testing

### Test File

`server/src/testCC.ts` - Comprehensive test suite

**Running Tests:**
```bash
# Using ts-node (development)
npx ts-node server/src/testCC.ts

# Using npm script (if added to package.json)
npm --prefix server run test:cc
```

**Test Cases:**

1. **Test 1**: Start new chat in primary directory
   - Verifies session creation
   - Confirms session ID capture

2. **Test 2**: Resume conversation in primary directory
   - Verifies session lookup by key
   - Confirms continuation of conversation

3. **Test 3**: Start chat in alternate directory
   - Verifies separate session for different cwd
   - Confirms isolation from Test 1

4. **Test 4**: Resume conversation in alternate directory
   - Verifies correct session is resumed

5. **Test 5**: Resume primary conversation again
   - Verifies session isolation is maintained
   - Confirms sessions don't interfere with each other

## Future Enhancements

1. **Database Persistence**
   - Store sessions in database instead of memory
   - Persist conversation metadata

2. **Session Expiration**
   - Auto-cleanup inactive sessions
   - Configurable TTL per session

3. **Streaming Integration**
   - Real-time response streaming to client
   - Chunked message delivery

4. **Tool Execution Handling**
   - Display tool calls to user
   - Handle long-running tool operations
   - Stream tool progress

5. **Error Recovery**
   - Reconnection logic for lost sessions
   - Graceful degradation

6. **Cost Tracking**
   - Integrate with credit system
   - Track tokens per session

## Architecture Decisions

### Why Composite Keys?

- **Simplicity**: No need for nested maps or complex lookups
- **Scalability**: Linear lookup by string key
- **Isolation**: Prevents accidental session mixing
- **Testability**: Easy to verify correct key generation

### Why In-Memory Storage?

- **MVP Speed**: Quick to test SDK integration
- **No Schema Changes**: Don't need to modify database
- **Easy to Replace**: Can swap with database implementation later

### Why Pass CWD to Every Function?

- **Explicit Context**: No hidden state or assumptions
- **Multi-Project Support**: Caller must specify context
- **Clarity**: Function signature shows context is important
- **Flexibility**: Allows dynamic cwd changes in future

## Dependencies

- `@anthropic-ai/claude-agent-sdk` - Agent SDK
- `@anthropic-ai/sdk` - Peer dependency
- `@modelcontextprotocol/sdk` - Peer dependency (for MCP support)

## Error Handling

All functions wrap execution in try-catch:

```typescript
try {
  // Execute query
} catch (error) {
  console.error("[CC] Error in function:", error);
  throw error;  // Propagate to caller
}
```

Errors are logged with `[CC]` prefix for easy filtering.

## Logging

All operations are logged with standardized format:

```
[CC] Starting new chat for conversation: conv-123
[CC] Working directory: /home/user/project
[CC] User message: Hello!
[CC] Message Type: text
[CC] Session ID saved for key "conv-123:/home/user/project": sess-xyz789
```

This enables:
- Debugging multi-directory scenarios
- Tracking session lifecycle
- Verifying cwd correctness
