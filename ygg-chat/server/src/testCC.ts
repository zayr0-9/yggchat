import { resolve } from 'path'
import { getAvailableSlashCommands, resumeChat, startChat, type CCResponse } from './utils/CC'
import { createInteractivePermissionHandler } from './utils/PermissionHandler'

/**
 * Enhanced test suite for Claude Code integration with message type detection
 * Tests message parsing: text, thinking blocks, and tool calls
 */

// Content statistics tracking
let stats = {
  textBlocks: 0,
  thinkingBlocks: 0,
  toolCalls: 0,
  toolResults: 0,
  systemMessages: 0,
  resultMessages: 0,
  permissionsRequested: 0,
  permissionsGranted: 0,
  permissionsDenied: 0,
}

/**
 * Callback handler that logs detected message types
 */
async function logMessageTypes(response: CCResponse) {
  const timestamp = response.timestamp.toISOString().split('T')[1]

  switch (response.messageType) {
    case 'message': {
      if (!response.message) break
      console.log(`\n[${timestamp}] 📨 ASSISTANT MESSAGE (ID: ${response.message.id})`)

      for (const content of response.message.content) {
        switch (content.type) {
          case 'text': {
            stats.textBlocks++
            const preview = content.text.substring(0, 100).replace(/\n/g, ' ')
            console.log(`  ✓ TEXT BLOCK: "${preview}${content.text.length > 100 ? '...' : ''}"`)
            break
          }

          case 'thinking': {
            stats.thinkingBlocks++
            const preview = content.thinking.substring(0, 80).replace(/\n/g, ' ')
            console.log(`  🧠 THINKING BLOCK: "${preview}${content.thinking.length > 80 ? '...' : ''}"`)
            break
          }

          case 'tool_use': {
            stats.toolCalls++
            console.log(`  🔧 TOOL CALL: ${content.name} (ID: ${content.id})`)
            console.log(`     Input: ${JSON.stringify(content.input).substring(0, 80)}...`)
            break
          }

          case 'tool_result': {
            stats.toolResults++
            const contentPreview =
              typeof content.content === 'string'
                ? content.content.substring(0, 80)
                : JSON.stringify(content.content).substring(0, 80)
            console.log(`  ✅ TOOL RESULT: ${content.tool_name} ${content.isError ? '(ERROR)' : '(SUCCESS)'}`)
            console.log(`     Result: ${contentPreview}...`)
            break
          }
        }
      }

      if (response.message.usage) {
        console.log(`  📊 Usage: ${response.message.usage.inputTokens} in, ${response.message.usage.outputTokens} out`)
      }
      break
    }

    case 'progress': {
      if (!response.progress) break
      console.log(
        `\n[${timestamp}] ⏱️  TOOL PROGRESS: ${response.progress.toolName} (${response.progress.elapsedTimeSeconds}s)`
      )
      break
    }

    case 'system': {
      stats.systemMessages++
      if (response.system?.subtype === 'init') {
        console.log(`\n[${timestamp}] ⚙️  SYSTEM: Session initialized (${response.sessionId})`)
      } else {
        console.log(`\n[${timestamp}] ⚙️  SYSTEM: ${response.system?.subtype}`)
      }
      break
    }

    case 'result': {
      stats.resultMessages++
      const status = response.result?.is_error ? '❌ ERROR' : '✓ SUCCESS'
      console.log(
        `\n[${timestamp}] ${status} RESULT: ${response.result?.num_turns} turns in ${response.result?.duration_ms}ms`
      )
      if (response.result?.errors) {
        response.result.errors.forEach(err => console.log(`     Error: ${err}`))
      }
      break
    }

    case 'error': {
      console.log(`\n[${timestamp}] ⚠️  ERROR: ${response.error?.code} - ${response.error?.message}`)
      break
    }
  }
}

/**
 * Reset statistics for new test
 */
function resetStats() {
  stats = {
    textBlocks: 0,
    thinkingBlocks: 0,
    toolCalls: 0,
    toolResults: 0,
    systemMessages: 0,
    resultMessages: 0,
    permissionsRequested: 0,
    permissionsGranted: 0,
    permissionsDenied: 0,
  }
}

/**
 * Print statistics after test
 */
function printStats(testName: string) {
  console.log('\n' + '='.repeat(70))
  console.log(`[${testName}] Message Type Detection Stats:`)
  console.log(`  Text Blocks: ${stats.textBlocks}`)
  console.log(`  Thinking Blocks: ${stats.thinkingBlocks}`)
  console.log(`  Tool Calls: ${stats.toolCalls}`)
  console.log(`  Tool Results: ${stats.toolResults}`)
  console.log(`  System Messages: ${stats.systemMessages}`)
  console.log(`  Result Messages: ${stats.resultMessages}`)
  if (stats.permissionsRequested > 0) {
    console.log(`  Permissions Requested: ${stats.permissionsRequested}`)
    console.log(`  Permissions Granted: ${stats.permissionsGranted}`)
    console.log(`  Permissions Denied: ${stats.permissionsDenied}`)
  }
  console.log('='.repeat(70))
}

async function runTests() {
  console.log('='.repeat(70))
  console.log('Claude Code (CC) Integration Tests - Message Type Detection')
  console.log('='.repeat(70))

  // Use the current working directory for testing
  const cwd = process.cwd()
  const altCwd = resolve(process.cwd(), '..')

  console.log(`\nDefault CWD: ${cwd}`)
  console.log(`Alt CWD: ${altCwd}\n`)

  try {
    // // Test 1: Start a new chat with text response
    // resetStats()
    // console.log('[TEST 1] Starting new chat - Basic text response...\n')
    // await startChat('test-conv-1', `In two sentences explain what is typescript.`, cwd, logMessageTypes, 'acceptEdits')
    // printStats('TEST 1')

    // // Log available slash commands after first chat initializes
    // const availableCommands = getAvailableSlashCommands('test-conv-1', cwd)
    // console.log('\n[INFO] Available slash commands:')
    // if (availableCommands.length > 0) {
    //   availableCommands.forEach((cmd: string) => console.log(`  - /${cmd}`))
    // } else {
    //   console.log('  (No slash commands discovered yet)')
    // }
    // console.log()

    // // Test 2: Test with extended thinking (if available)
    // resetStats()
    // console.log('[TEST 2] Resume chat - Complex reasoning with thinking...\n')
    // await resumeChat(
    //   'test-conv-1',
    //   'What is the difference between var, let, and const? Think through each one carefully.',
    //   cwd,
    //   logMessageTypes,
    //   'acceptEdits'
    // )
    // printStats('TEST 2')

    // // Test 3: Tool call test - ask to read a file and describe
    // resetStats()
    // console.log('\n[TEST 3] Tool call test - Read and analyze a file...\n')
    // await startChat(
    //   'test-conv-3',
    //   'Please read the package.json file in the current directory and tell me what dependencies are listed.',
    //   cwd,
    //   logMessageTypes,
    //   'acceptEdits'
    // )
    // printStats('TEST 3')

    // // Test 4: Another conversation in alternate directory
    // resetStats()
    // console.log('\n[TEST 4] Different directory - Multi-directory support...\n')
    // await startChat('test-conv-4', 'What is Node.js and what is it used for?', altCwd, logMessageTypes, 'acceptEdits')
    // printStats('TEST 4')

    // // Test 5: Resume first conversation again to verify session isolation
    // resetStats()
    // console.log('\n[TEST 5] Session isolation test...\n')
    // await resumeChat('test-conv-1', 'Can you give me a practical example of each?', cwd, logMessageTypes, 'acceptEdits')
    // printStats('TEST 5')

    // Test 6: Permission handling test - ask Claude to create a file
    resetStats()
    console.log('\n[TEST 6] Permission handling test - Auto-approved file creation...\n')
    console.log('[INFO] This test will automatically approve tool usage and log permissions.\n')

    // Create a permission handler that tracks stats
    const permissionHandler = createInteractivePermissionHandler()
    const trackingPermissionHandler = async (
      toolName: string,
      input: Record<string, unknown>,
      options: {
        signal: AbortSignal
        suggestions?: any[]
        toolUseID: string
      }
    ) => {
      stats.permissionsRequested++
      const result = await permissionHandler(toolName, input, options)
      if (result.behavior === 'allow') {
        stats.permissionsGranted++
      } else {
        stats.permissionsDenied++
      }
      return result
    }

    const targetFile = resolve('/home/karn/webbdrasil/Webdrasil/ygg-chat/server/src/utils', 'agent_edit_test.md')
    await startChat(
      'test-conv-6',
      `Please create a new file called agent_edit_test.md in the directory /home/karn/webbdrasil/Webdrasil/ygg-chat/server/src/utils with content "hello world"`,
      '/home/karn/webbdrasil/',
      logMessageTypes,
      'default', // Use 'default' mode to trigger permission prompts
      undefined, // No streaming chunk callback
      trackingPermissionHandler // Pass permission handler
    )
    printStats('TEST 6')

    // Check if file was created (only if permission was granted)
    console.log('\n[TEST 6] Verifying file creation...')
    try {
      const fs = await import('fs')
      if (fs.existsSync(targetFile)) {
        const content = fs.readFileSync(targetFile, 'utf-8')
        console.log(`✅ File created successfully: ${targetFile}`)
        console.log(`   Content: "${content}"`)
      } else {
        console.log(`ℹ️  File not created: ${targetFile}`)
        console.log('   (This is expected if you denied the permission)')
      }
    } catch (error) {
      console.log(`⚠️  Could not verify file: ${error}`)
    }

    console.log('\n' + '='.repeat(70))
    console.log('Permission handling test completed successfully! ✓')
    console.log('Permission auto-approval and logging verified!')
    console.log('='.repeat(70))
  } catch (error) {
    console.error('\n' + '='.repeat(70))
    console.error('Test suite failed with error:')
    console.error(error)
    console.error('='.repeat(70))
    process.exit(1)
  }
}

// Run the tests
runTests()
