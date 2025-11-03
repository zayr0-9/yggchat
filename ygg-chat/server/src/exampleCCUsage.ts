/**
 * Example usage of the updated Claude Code integration with message parsing
 * Shows how to handle different message types for frontend display
 */

import {
  startChat,
  resumeChat,
  type CCResponse,
  type ParsedMessage,
  type ParsedContent,
} from "./utils/CC";

/**
 * Example callback handler for processing parsed responses
 * This shows how to structure data for different content types
 */
async function handleCCResponse(response: CCResponse) {
  const timestamp = response.timestamp.toISOString();

  switch (response.messageType) {
    // Handle assistant message responses
    case "message": {
      if (!response.message) break;

      console.log(`\n[${timestamp}] Assistant Message`);
      console.log(`Message ID: ${response.message.id}`);
      console.log(`Stop Reason: ${response.message.stopReason}`);

      // Process each content block
      for (const content of response.message.content) {
        switch (content.type) {
          // Display text responses
          case "text": {
            console.log("\n--- Text Content ---");
            console.log(content.text);
            if (content.citations && content.citations.length > 0) {
              console.log("Citations:", content.citations.length);
            }
            break;
          }

          // Display thinking blocks separately
          case "thinking": {
            console.log("\n--- Thinking Block (Extended Thinking) ---");
            console.log(content.thinking);
            break;
          }

          // Display tool calls
          case "tool_use": {
            console.log("\n--- Tool Call ---");
            console.log(`Tool: ${content.name}`);
            console.log(`Tool ID: ${content.id}`);
            console.log("Input:", JSON.stringify(content.input, null, 2));
            break;
          }

          // Display tool results
          case "tool_result": {
            console.log("\n--- Tool Result ---");
            console.log(`Tool: ${content.tool_name}`);
            console.log(`Tool Use ID: ${content.tool_use_id}`);
            if (content.isError) {
              console.log("ERROR:", content.content);
            } else {
              console.log("Result:", JSON.stringify(content.content, null, 2));
            }
            break;
          }

          default:
            console.log(`Unknown content type: ${(content as any).type}`);
        }
      }

      // Display usage stats if available
      if (response.message.usage) {
        console.log("\n--- Token Usage ---");
        console.log(`Input tokens: ${response.message.usage.inputTokens}`);
        console.log(`Output tokens: ${response.message.usage.outputTokens}`);
      }
      break;
    }

    // Handle tool progress updates
    case "progress": {
      if (!response.progress) break;

      console.log(
        `[${timestamp}] Tool Progress: ${response.progress.toolName} ` +
        `(${response.progress.elapsedTimeSeconds}s)`
      );
      break;
    }

    // Handle system messages
    case "system": {
      if (!response.system) break;

      switch (response.system.subtype) {
        case "init":
          console.log(`[${timestamp}] Session initialized: ${response.sessionId}`);
          break;
        case "compact_boundary":
          console.log(`[${timestamp}] Memory compaction occurred`);
          break;
        case "auth_status":
          console.log(`[${timestamp}] Auth status update`);
          break;
        case "hook_response":
          console.log(`[${timestamp}] Hook response received`);
          break;
      }
      break;
    }

    // Handle final result
    case "result": {
      if (!response.result) break;

      console.log(`\n[${timestamp}] Chat Complete`);
      console.log(`Status: ${response.result.subtype}`);
      console.log(`Turns: ${response.result.num_turns}`);
      console.log(`Duration: ${response.result.duration_ms}ms`);

      if (response.result.is_error) {
        console.log("Errors:", response.result.errors);
      } else if (response.result.result) {
        console.log("Final Result:", response.result.result);
      }
      break;
    }

    // Handle errors
    case "error": {
      if (!response.error) break;

      console.error(`[${timestamp}] Error (${response.error.code})`);
      console.error(response.error.message);
      break;
    }
  }
}

/**
 * Example: Start a new chat with parsing
 */
async function exampleStartChat() {
  console.log("=== Example: Start Chat with Message Parsing ===\n");

  await startChat(
    "conversation-1",
    "Can you help me understand TypeScript generics? Show me some examples.",
    process.cwd(),
    handleCCResponse // Pass the callback to receive structured responses
  );

  console.log("\n=== Chat Complete ===\n");
}

/**
 * Example: Resume an existing chat
 */
async function exampleResumeChat() {
  console.log("=== Example: Resume Chat with Message Parsing ===\n");

  await resumeChat(
    "conversation-1",
    "Now show me how to use generics with classes",
    process.cwd(),
    handleCCResponse // Pass the callback to receive structured responses
  );

  console.log("\n=== Chat Complete ===\n");
}

/**
 * Example: Using the callback for different UI scenarios
 * This shows how your frontend could structure the data differently
 */
async function exampleCustomCallback() {
  console.log("=== Example: Custom Callback for Frontend ===\n");

  /**
   * Example of a custom callback that structures data for WebSocket emission
   */
  const customCallback = async (response: CCResponse) => {
    // Transform the response for your frontend format
    const frontendMessage = {
      id: response.messageId || response.sessionId,
      timestamp: response.timestamp,
      type: response.messageType,

      // Structure for different message types
      ...(response.messageType === "message" &&
        response.message && {
          textBlocks: response.message.content
            .filter((c) => c.type === "text")
            .map((c) => (c as any).text),

          thinkingBlocks: response.message.content
            .filter((c) => c.type === "thinking")
            .map((c) => (c as any).thinking),

          toolCalls: response.message.content
            .filter((c) => c.type === "tool_use")
            .map((c) => ({
              id: (c as any).id,
              name: (c as any).name,
              input: (c as any).input,
            })),

          toolResults: response.message.content
            .filter((c) => c.type === "tool_result")
            .map((c) => ({
              toolId: (c as any).tool_use_id,
              toolName: (c as any).tool_name,
              content: (c as any).content,
              isError: (c as any).isError,
            })),
        }),

      // Include progress data
      ...(response.messageType === "progress" &&
        response.progress && {
          progress: response.progress,
        }),

      // Include system/result data
      ...(["system", "result"].includes(response.messageType) && {
        data: response.system || response.result,
      }),
    };

    // Send to frontend via WebSocket, HTTP, etc.
    console.log("Send to frontend:", JSON.stringify(frontendMessage, null, 2));
  };

  await startChat(
    "conversation-2",
    "/help",
    process.cwd(),
    customCallback
  );
}

// Uncomment to run examples:
// exampleStartChat();
// exampleResumeChat();
// exampleCustomCallback();
