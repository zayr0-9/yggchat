/**
 * Parser for Claude Code Agent SDK responses
 * Detects and extracts different content types from assistant messages
 */

import {
  ParsedContent,
  ParsedMessage,
  ParsedTextContent,
  ParsedThinkingContent,
  ParsedToolUseContent,
  ParsedToolResultContent,
} from './CCTypes';

/**
 * Type guard for text block from SDK
 */
function isTextBlock(block: any): block is { type: 'text'; text: string; citations?: any[] } {
  return block && block.type === 'text' && typeof block.text === 'string';
}

/**
 * Type guard for thinking block from SDK
 */
function isThinkingBlock(block: any): block is { type: 'thinking'; thinking: string; signature?: string } {
  return block && block.type === 'thinking' && typeof block.thinking === 'string';
}

/**
 * Type guard for tool use block from SDK
 */
function isToolUseBlock(block: any): block is { type: 'tool_use'; id: string; name: string; input: unknown } {
  return (
    block &&
    block.type === 'tool_use' &&
    typeof block.id === 'string' &&
    typeof block.name === 'string' &&
    block.input !== undefined
  );
}

/**
 * Type guard for tool result blocks from SDK
 */
function isToolResultBlock(block: any): boolean {
  if (!block || !block.type) return false;
  const toolResultTypes = [
    'tool_result',
    'bash_code_execution_tool_result',
    'code_execution_tool_result',
    'text_editor_code_execution_tool_result',
    'web_search_tool_result',
    'web_fetch_tool_result',
  ];
  return toolResultTypes.includes(block.type);
}

/**
 * Extract tool result content from various tool result block types
 */
function extractToolResultContent(block: any): ParsedToolResultContent | null {
  if (!block || !isToolResultBlock(block)) return null;

  const toolUseId = block.tool_use_id || '';
  const toolName = block.tool_name || '';

  // Different tool result blocks have different content structures
  let content: string | Record<string, unknown> = '';
  let isError = false;

  if (block.type === 'bash_code_execution_tool_result' || block.type === 'code_execution_tool_result') {
    if (block.content?.type === 'bash_code_execution_tool_result_error' ||
        block.content?.type === 'code_execution_tool_result_error') {
      isError = true;
      content = {
        errorCode: block.content.error_code || block.content.errorCode,
        message: `Tool execution failed: ${block.content.error_code || 'unknown error'}`,
      };
    } else {
      content = {
        stdout: block.stdout || '',
        stderr: block.stderr || '',
        returnCode: block.return_code || 0,
      };
    }
  } else if (block.type === 'text_editor_code_execution_tool_result') {
    content = {
      result: block.content?.result || block.result || '',
      file: block.content?.file || '',
    };
  } else if (block.type === 'web_search_tool_result') {
    content = {
      results: block.content || [],
    };
  } else if (block.type === 'web_fetch_tool_result') {
    if (block.content?.type === 'web_fetch_tool_result_error') {
      isError = true;
      content = {
        errorCode: block.content.error_code,
        message: `Web fetch failed: ${block.content.error_code}`,
      };
    } else {
      content = block.content || {};
    }
  } else {
    // Generic handling for unknown tool result types
    content = block.content || block;
  }

  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    tool_name: toolName,
    content,
    isError,
  };
}

/**
 * Parse a single content block from SDK response
 */
function parseContentBlock(block: any): ParsedContent | null {
  if (!block) return null;

  // Handle text blocks
  if (isTextBlock(block)) {
    const parsed: ParsedTextContent = {
      type: 'text',
      text: block.text,
    };
    if (block.citations && block.citations.length > 0) {
      parsed.citations = block.citations;
    }
    return parsed;
  }

  // Handle thinking blocks
  if (isThinkingBlock(block)) {
    return {
      type: 'thinking',
      thinking: block.thinking,
      signature: block.signature,
    } as ParsedThinkingContent;
  }

  // Handle tool use blocks
  if (isToolUseBlock(block)) {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input,
    } as ParsedToolUseContent;
  }

  // Handle tool result blocks
  const toolResult = extractToolResultContent(block);
  if (toolResult) {
    return toolResult;
  }

  // Log unhandled block types for debugging
  if (block.type) {
    console.log(`[CCParser] Unhandled content block type: ${block.type}`);
  }

  return null;
}

/**
 * Parse an assistant message from SDK response
 * Extracts all content blocks and categorizes them
 */
export function parseAssistantMessage(
  messageId: string,
  content: any[],
  stopReason?: string,
  usage?: any
): ParsedMessage {
  const parsedContent: ParsedContent[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      const parsed = parseContentBlock(block);
      if (parsed) {
        parsedContent.push(parsed);
      }
    }
  }

  const message: ParsedMessage = {
    id: messageId,
    type: 'message',
    content: parsedContent,
    stopReason: stopReason,
  };

  // Add usage if available
  if (usage) {
    message.usage = {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheReadInputTokens: usage.cache_read_input_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens,
    };
  }

  return message;
}

/**
 * Get counts of different content types in a message
 */
export function getContentStats(message: ParsedMessage): {
  textBlocks: number;
  thinkingBlocks: number;
  toolUseBlocks: number;
  toolResultBlocks: number;
  otherBlocks: number;
} {
  const stats = {
    textBlocks: 0,
    thinkingBlocks: 0,
    toolUseBlocks: 0,
    toolResultBlocks: 0,
    otherBlocks: 0,
  };

  for (const content of message.content) {
    switch (content.type) {
      case 'text':
        stats.textBlocks++;
        break;
      case 'thinking':
        stats.thinkingBlocks++;
        break;
      case 'tool_use':
        stats.toolUseBlocks++;
        break;
      case 'tool_result':
        stats.toolResultBlocks++;
        break;
      default:
        stats.otherBlocks++;
    }
  }

  return stats;
}

/**
 * Extract only text content from a message
 */
export function extractTextContent(message: ParsedMessage): string {
  return message.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as ParsedTextContent).text)
    .join('\n');
}

/**
 * Extract only thinking content from a message
 */
export function extractThinkingContent(message: ParsedMessage): string[] {
  return message.content
    .filter((c) => c.type === 'thinking')
    .map((c) => (c as ParsedThinkingContent).thinking);
}

/**
 * Extract tool calls from a message
 */
export function extractToolCalls(message: ParsedMessage): ParsedToolUseContent[] {
  return message.content.filter((c) => c.type === 'tool_use') as ParsedToolUseContent[];
}

/**
 * Log message statistics for debugging
 */
export function logMessageStats(message: ParsedMessage): void {
  const stats = getContentStats(message);
  console.log(`[CCParser] Message ID: ${message.id}`);
  console.log(`[CCParser] Content blocks: text=${stats.textBlocks}, thinking=${stats.thinkingBlocks}, tool_use=${stats.toolUseBlocks}, tool_result=${stats.toolResultBlocks}`);
  if (stats.otherBlocks > 0) {
    console.log(`[CCParser] Other blocks: ${stats.otherBlocks}`);
  }
  if (message.usage) {
    console.log(
      `[CCParser] Usage: input=${message.usage.inputTokens}, output=${message.usage.outputTokens}`
    );
  }
}
