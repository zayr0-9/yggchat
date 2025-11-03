# Claude Code Supabase Integration Plan

## Overview

This document outlines the integration between Claude Code Agent SDK messages and the Supabase database for persistent storage of agent conversations.

## Problem Statement

Currently, Claude Code (CC) SDK messages are processed in-memory only through `CC.ts`. There is no persistence layer to:
- Save CC agent messages to the database
- Track which messages belong to which CC session
- Resume CC sessions from database state
- Differentiate between regular chat messages and external agent messages

## Solution Architecture

### 1. Database Schema Changes

#### 1.1 New message_role: `ex_agent`

Add a new role type to distinguish external agent messages from regular assistant messages.

```sql
ALTER TYPE message_role ADD VALUE 'ex_agent';
```

**Rationale**:
- Separates external agent messages (like Claude Code) from regular assistant responses
- Allows filtering and querying specifically for agent-generated content
- Future-proof for other external agents

#### 1.2 New field: `ex_agent_session_id`

Add tracking field to messages table:

```sql
ALTER TABLE messages
  ADD COLUMN ex_agent_session_id TEXT NULL;
```

**Purpose**:
- Links messages to their originating CC session
- Enables session-based message retrieval
- Facilitates conversation forking and branching
- Required for resuming CC sessions

#### 1.3 New field: `ex_agent_type`

Optional field to specify which external agent created the message:

```sql
ALTER TABLE messages
  ADD COLUMN ex_agent_type TEXT NULL;
```

**Values**:
- `'claude_code'` - Messages from Claude Code SDK
- Future: Other agent types as needed

#### 1.4 Index for performance

```sql
CREATE INDEX idx_messages_ex_agent_session
  ON messages(ex_agent_session_id)
  WHERE ex_agent_session_id IS NOT NULL;
```

#### 1.5 Optional: `cwd` field in conversations

```sql
ALTER TABLE conversations
  ADD COLUMN cwd TEXT NULL;
```

**Purpose**: Store working directory for CC sessions to maintain context

### 2. Message Mapping Strategy

#### CC SDK Message Types → Database Fields

| CC Message Component | Database Field | Notes |
|---------------------|----------------|-------|
| ParsedTextContent | `content` | Concatenate all text blocks with newlines |
| ParsedThinkingContent | `thinking_block` | Extended reasoning/thinking content |
| ParsedToolUseContent | `tool_calls` (JSONB) | Array of tool invocations with parameters |
| ParsedToolResultContent | `note` or append to `content` | Tool execution results |
| sessionId | `ex_agent_session_id` | CC SDK session identifier |
| model (from usage) | `model_name` | Extract from CC response |
| role | `role = 'ex_agent'` | Mark as external agent message |

#### Content Assembly Algorithm

```typescript
// Pseudocode for message content assembly
function assembleCCContent(parsedMessage: ParsedMessage): {
  content: string
  thinking_block: string
  tool_calls: any[]
} {
  let content = []
  let thinking_block = []
  let tool_calls = []

  for (const block of parsedMessage.content) {
    switch (block.type) {
      case 'text':
        content.push(block.text)
        break
      case 'thinking':
        thinking_block.push(block.thinking)
        break
      case 'tool_use':
        tool_calls.push({
          id: block.id,
          name: block.name,
          input: block.input
        })
        break
      case 'tool_result':
        // Option 1: Append to content
        content.push(`[Tool Result: ${block.toolUseId}]\n${block.content}`)
        // Option 2: Store in separate field
        break
    }
  }

  return {
    content: content.join('\n'),
    thinking_block: thinking_block.join('\n'),
    tool_calls: tool_calls.length > 0 ? tool_calls : null
  }
}
```

### 3. Integration Flow

#### 3.1 New CC Chat Flow

```
User Request
  ↓
POST /conversations/:id/cc-messages
  ↓
Create user message in DB (role='user')
  ↓
Call startCCChatWithDB(conversationId, message, cwd, userId, jwt)
  ↓
CC.startChat() with OnResponse callback
  ↓
For each CC response:
  - Parse message content
  - Create message in DB (role='ex_agent')
  - Set ex_agent_session_id
  - Link to parent (user message)
  - Stream to client
  ↓
Return conversation with new messages
```

#### 3.2 Resume CC Chat Flow

```
User Request (existing conversation)
  ↓
POST /conversations/:id/cc-messages
  ↓
Query last message with ex_agent_session_id
  ↓
Create user message in DB (role='user')
  ↓
Call resumeCCChatWithDB(conversationId, sessionId, message, cwd, userId, jwt)
  ↓
CC.resumeChat() with OnResponse callback
  ↓
Save responses to DB (same as above)
  ↓
Return updated conversation
```

### 4. File Structure

```
server/src/
├── utils/
│   ├── CC.ts                    # Existing CC SDK wrapper
│   ├── CCTypes.ts               # Existing type definitions
│   ├── CCParser.ts              # Existing message parser
│   ├── CCSupabase.ts            # NEW: Database integration
│   └── CCsupa.md                # This planning doc
├── database/
│   └── supamodels.ts            # Existing database models
├── routes/
│   └── supaChat.ts              # MODIFY: Add CC endpoint
└── migrations/
    └── add_ex_agent_fields.sql  # NEW: Database migration
```

### 5. Key Functions in CCSupabase.ts

#### 5.1 `saveCCMessageToDatabase()`

```typescript
async function saveCCMessageToDatabase(
  client: SupabaseClient,
  conversationId: string,
  ownerId: string,
  ccResponse: CCResponse,
  parentId: string | null,
  sessionId: string
): Promise<Message>
```

**Responsibilities**:
- Convert CCResponse to database Message format
- Set role to 'ex_agent'
- Parse and store content, thinking_block, tool_calls
- Set ex_agent_session_id
- Call MessageService.create()

#### 5.2 `createCCResponseCallback()`

```typescript
function createCCResponseCallback(
  client: SupabaseClient,
  conversationId: string,
  ownerId: string,
  userMessageId: string,
  onStream?: (data: any) => void
): OnResponse
```

**Responsibilities**:
- Return callback compatible with CC OnResponse type
- Track parent_id for message threading
- Save each assistant message to database
- Forward progress/system messages to client
- Handle errors gracefully

#### 5.3 `startCCChatWithDB()`

```typescript
async function startCCChatWithDB(
  conversationId: string,
  userMessage: string,
  cwd: string,
  userId: string,
  jwt: string,
  permissionMode?: string,
  onStream?: (data: any) => void
): Promise<{ conversation: Conversation; messages: Message[] }>
```

**Responsibilities**:
- Create authenticated Supabase client
- Verify conversation exists and user has access
- Save user message to database
- Call CC.startChat() with database callback
- Return updated conversation state

#### 5.4 `resumeCCChatWithDB()`

```typescript
async function resumeCCChatWithDB(
  conversationId: string,
  userMessage: string,
  cwd: string,
  userId: string,
  jwt: string,
  permissionMode?: string,
  onStream?: (data: any) => void
): Promise<{ conversation: Conversation; messages: Message[] }>
```

**Responsibilities**:
- Retrieve last ex_agent_session_id from database
- Create authenticated Supabase client
- Save user message to database
- Call CC.resumeChat() with database callback
- Return updated conversation state

### 6. API Endpoint Design

#### 6.1 New Endpoint: `POST /conversations/:id/cc-messages`

**Request**:
```typescript
{
  message: string              // User message
  cwd?: string                 // Working directory (default: project root)
  permissionMode?: string      // 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits'
  parentId?: string | null     // Optional parent message ID for threading
}
```

**Response**:
```typescript
{
  conversation: Conversation
  messages: Message[]          // All new messages (user + agent responses)
  sessionId: string           // CC session ID for future reference
}
```

**Streaming**:
- Use Server-Sent Events (SSE) or WebSocket
- Stream CC progress updates in real-time
- Final response includes full conversation state

#### 6.2 Query Endpoint: `GET /conversations/:id/cc-session`

**Response**:
```typescript
{
  sessionId: string | null     // Current CC session ID for conversation
  lastMessageAt: string        // Timestamp of last CC message
  messageCount: number         // Number of CC messages in conversation
  cwd: string | null          // Current working directory
}
```

**Purpose**: Check if CC session exists before resuming

### 7. Parent-Child Message Linking

#### 7.1 Linear Conversation Threading

```
User Message (parent_id: null)
  ↓ (parent_id: user_msg_id)
Agent Response (parent_id: user_msg_id)
  ↓ (parent_id: agent_msg_id)
User Message (parent_id: agent_msg_id)
  ↓ (parent_id: user_msg_id_2)
Agent Response (parent_id: user_msg_id_2)
```

#### 7.2 Branching Support (Future)

Multiple CC sessions can branch from same conversation:
- Each session tracked by unique `ex_agent_session_id`
- Parent relationships maintained within each branch
- UI can display multiple conversation paths

### 8. Error Handling Strategy

#### 8.1 CC Errors

When CC returns error response:
- Save error as message with role='system' or 'ex_agent'
- Set note field with error details
- Include error_code in metadata (tool_calls JSONB)
- Allow user to retry from this point

#### 8.2 Database Errors

When database save fails:
- Log error details
- Continue CC session (don't break flow)
- Attempt to save on next message
- Notify client of persistence failure

#### 8.3 Session Resume Failures

When CC session can't be resumed:
- Fall back to starting new CC session
- Log warning about session loss
- Continue with new session ID
- Update database with new session ID

### 9. Migration Checklist

- [ ] Create migration file `add_ex_agent_fields.sql`
- [ ] Test migration on development database
- [ ] Add rollback script
- [ ] Update database schema documentation
- [ ] Create seed data for testing
- [ ] Verify RLS policies work with new fields
- [ ] Update API documentation

### 10. Testing Strategy

#### 10.1 Unit Tests

- Content assembly from ParsedContent
- Message saving with all field types
- Session ID tracking and retrieval
- Parent-child linking logic

#### 10.2 Integration Tests

- Full CC conversation flow with database
- Session resumption
- Error handling and recovery
- Multiple concurrent sessions

#### 10.3 Manual Tests

- Send message via CC endpoint
- Verify database contains correct data
- Resume conversation in new request
- Test with different permission modes
- Test with tool-using conversations

### 11. Performance Considerations

#### 11.1 Database Writes

- Each CC message creates 1 database INSERT
- Use single authenticated client per request
- Batch operations where possible
- Index on ex_agent_session_id for fast lookups

#### 11.2 Session Management

- In-memory session cache (existing in CC.ts)
- Database as source of truth for historical sessions
- Lazy-load session IDs from database on resume

#### 11.3 Streaming Performance

- Non-blocking database writes
- Stream to client immediately
- Save to database asynchronously
- Queue writes if needed for high concurrency

### 12. Security Considerations

#### 12.1 RLS Enforcement

- All operations use authenticated Supabase client
- RLS policies automatically enforce owner_id filtering
- JWT token validated on every request
- No direct admin client usage in API endpoints

#### 12.2 Session Isolation

- Session IDs scoped to user via RLS
- Users can't access other users' CC sessions
- cwd path sanitization to prevent directory traversal

#### 12.3 Input Validation

- Validate conversation exists and user has access
- Sanitize cwd paths
- Validate permissionMode enum values
- Rate limiting on CC endpoint (expensive operation)

### 13. Future Enhancements

#### 13.1 Multi-Agent Support

- Support for multiple external agent types
- Agent selection per conversation
- Agent-specific configuration storage

#### 13.2 Conversation Forking

- Fork conversations at any message
- Create branches with different CC sessions
- UI for navigating conversation branches

#### 13.3 Tool Result Storage

- Dedicated table for tool executions
- Link tool results to messages
- Enable tool execution replay/audit

#### 13.4 Cost Tracking

- Integrate CC usage with existing ProviderCost table
- Track tokens and costs for CC messages
- Credit system integration

### 14. Open Questions & Decisions Needed

1. **Auto-save all messages?**
   - Current plan: Yes, auto-save via OnResponse callback
   - Alternative: Explicit save calls from client

2. **System messages from CC?**
   - Current plan: Save as role='system'
   - Alternative: Don't save, only stream to client

3. **Tool results storage?**
   - Current plan: Include in message content/note
   - Alternative: Separate tool_results table

4. **Session ID source of truth?**
   - Current plan: Database (query on resume)
   - Alternative: Client provides session ID

5. **Concurrent CC sessions per conversation?**
   - Current plan: Allow (tracked by session_id)
   - Alternative: One active session per conversation

6. **cwd flexibility?**
   - Current plan: User can change per message
   - Alternative: Set once per conversation

### 15. Implementation Timeline

**Phase 1 - Database (Day 1)**
- Create migration file
- Test migration
- Verify schema changes

**Phase 2 - Core Integration (Day 1-2)**
- Create CCSupabase.ts
- Implement saveCCMessageToDatabase()
- Implement createCCResponseCallback()
- Implement startCCChatWithDB()
- Implement resumeCCChatWithDB()

**Phase 3 - API Endpoint (Day 2)**
- Add POST /conversations/:id/cc-messages endpoint
- Implement streaming response
- Add authentication and authorization
- Error handling

**Phase 4 - Testing (Day 3)**
- Unit tests for content assembly
- Integration tests for full flow
- Manual testing with real CC conversations

**Phase 5 - Documentation (Day 3)**
- Update API documentation
- Add usage examples
- Document migration process

## Conclusion

This integration bridges the gap between ephemeral CC SDK sessions and persistent database storage, enabling:
- Full conversation history for CC interactions
- Session resumption across requests
- Proper attribution of agent-generated content
- Foundation for multi-agent systems

The design maintains separation of concerns while leveraging existing database infrastructure and RLS security model.
