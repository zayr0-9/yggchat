/**
 * Shared iframe message bridge for custom tools
 * Used by both HtmlIframeRegistry (Tool Manager) and ChatMessage (Inline Chat)
 * to ensure consistent IPC handler support across all contexts.
 */

import { createStreamingRequest } from './api'

type StreamState = {
  targets: Set<string>
  pendingEvents: Map<string, Array<{ type: string; payload: any }>>
  awaitingResponse: number
}

type BridgeContext = {
  getIframe: () => HTMLIFrameElement | null
  getUserId: () => string | null
}

/**
 * Creates the message handler function for iframe IPC bridge
 */
export function createMessageHandler(
  context: BridgeContext,
  streamState: StreamState,
  flushPendingEvents: (streamId: string) => void
) {
  const electronAPI = (window as any).electronAPI

  return async (event: MessageEvent) => {
    const iframe = context.getIframe()
    if (!iframe || event.source !== iframe.contentWindow) {
      return
    }

    const { type, requestId, options } = event.data || {}
    if (!type || !requestId) return

    let response: any = { success: false, error: 'Unknown request type' }

    try {
      switch (type) {
        case 'DIALOG_OPEN_FILE':
          if (electronAPI?.dialog?.openFile) {
            response = await electronAPI.dialog.openFile(options)
          } else {
            response = { success: false, error: 'File dialog not available (not in Electron)' }
          }
          break

        case 'DIALOG_SAVE_FILE':
          if (electronAPI?.dialog?.saveFile) {
            response = await electronAPI.dialog.saveFile(options)
          } else {
            response = { success: false, error: 'Save dialog not available (not in Electron)' }
          }
          break

        case 'FS_READ_FILE':
          if (electronAPI?.fs?.readFile) {
            response = await electronAPI.fs.readFile(options?.filePath, options?.encoding)
          } else {
            response = { success: false, error: 'File read not available (not in Electron)' }
          }
          break

        case 'FS_READ_FILE_STREAM':
          if (electronAPI?.fs?.readFileStream) {
            streamState.awaitingResponse += 1
            try {
              response = await electronAPI.fs.readFileStream(options?.filePath, {
                encoding: options?.encoding,
                highWaterMark: options?.highWaterMark,
              })
              if (response?.success && response?.streamId) {
                streamState.targets.add(response.streamId)
                flushPendingEvents(response.streamId)
              }
            } catch (err) {
              response = { success: false, error: String(err) }
            } finally {
              streamState.awaitingResponse = Math.max(0, streamState.awaitingResponse - 1)
              if (streamState.awaitingResponse === 0) {
                streamState.pendingEvents.clear()
              }
            }
          } else {
            response = { success: false, error: 'File stream not available (not in Electron)' }
          }
          break

        case 'FS_STAT':
          if (electronAPI?.fs?.stat) {
            response = await electronAPI.fs.stat(options?.filePath)
          } else {
            response = { success: false, error: 'File stat not available (not in Electron)' }
          }
          break

        case 'FS_ABORT':
          if (electronAPI?.fs?.abortReadFileStream) {
            response = await electronAPI.fs.abortReadFileStream(options?.streamId)
          } else {
            response = { success: false, error: 'Stream abort not available (not in Electron)' }
          }
          break

        case 'FS_WRITE_FILE':
          if (electronAPI?.fs?.writeFile) {
            response = await electronAPI.fs.writeFile(options?.filePath, options?.content, options?.encoding)
          } else {
            response = { success: false, error: 'File write not available (not in Electron)' }
          }
          break

        case 'FS_MKDIR':
          if (electronAPI?.fs?.mkdir) {
            response = await electronAPI.fs.mkdir(options?.dirPath)
          } else {
            response = { success: false, error: 'Mkdir not available (not in Electron)' }
          }
          break

        case 'SHELL_EXEC':
          if (electronAPI?.exec?.run) {
            response = await electronAPI.exec.run(options?.command, { cwd: options?.cwd, timeout: options?.timeout })
          } else {
            response = { success: false, error: 'Shell exec not available (not in Electron)' }
          }
          break

        case 'HTTP_REQUEST':
          if (electronAPI?.http?.request) {
            response = await electronAPI.http.request({
              url: options?.url,
              method: options?.method,
              headers: options?.headers,
              body: options?.body,
              timeout: options?.timeout,
            })
          } else {
            response = { success: false, error: 'HTTP request not available (not in Electron)' }
          }
          break

        case 'AUTH_CONTEXT': {
          const userId = context.getUserId()
          response = { success: true, tenantId: userId ?? null }
          break
        }

        case 'CUSTOM_TOOL_EXECUTE': {
          const { toolPath, args: toolArgs, bustCache } = options || {}
          if (!toolPath) {
            response = { success: false, error: 'Missing toolPath' }
            break
          }

          if (electronAPI?.customTool?.execute) {
            const execArgs = bustCache ? { ...toolArgs, _bustCache: true } : toolArgs
            response = await electronAPI.customTool.execute(toolPath, execArgs)
          } else {
            response = { success: false, error: 'Custom tool execution not available (not in Electron)' }
          }
          break
        }

        case 'CUSTOM_TOOL_CLEAR_CACHE': {
          const { toolPath } = options || {}
          if (electronAPI?.customTool?.clearCache) {
            response = await electronAPI.customTool.clearCache(toolPath)
          } else {
            response = { success: false, error: 'Custom tool cache clear not available (not in Electron)' }
          }
          break
        }

        case 'EXECUTE_TOOL': {
          const { tool, args: toolArgs } = options || {}
          if (!tool) {
            response = { success: false, error: 'Missing tool name' }
            break
          }

          try {
            const apiResponse = await fetch('http://127.0.0.1:3002/api/tools/execute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tool,
                args: toolArgs || {},
              }),
            })

            if (!apiResponse.ok) {
              response = { success: false, error: `HTTP ${apiResponse.status}: ${apiResponse.statusText}` }
              break
            }

            const result = await apiResponse.json()
            response = result.result || result
          } catch (err) {
            response = { success: false, error: String(err) }
          }
          break
        }

        case 'RPC': {
          const { namespace, method, args } = options || {}
          if (!namespace || !method) {
            response = { success: false, error: 'RPC requires namespace and method' }
            break
          }

          const allowedNamespaces = ['fs', 'dialog', 'shell', 'exec', 'http', 'storage', 'platformInfo']
          if (!allowedNamespaces.includes(namespace)) {
            response = { success: false, error: `Namespace not allowed: ${namespace}` }
            break
          }

          const api = (electronAPI as any)?.[namespace]
          if (!api) {
            response = { success: false, error: `Namespace not available: ${namespace} (not in Electron)` }
            break
          }

          const fn = api[method]
          if (typeof fn !== 'function') {
            response = { success: false, error: `Method not found: ${namespace}.${method}` }
            break
          }

          try {
            const result = await fn(...(Array.isArray(args) ? args : []))
            if (result && typeof result === 'object' && 'success' in result) {
              response = result
            } else {
              response = { success: true, result }
            }
          } catch (err) {
            response = { success: false, error: String(err) }
          }
          break
        }

        case 'REQUEST_GENERATION': {
          const { prompt, model, maxTokens, temperature, systemPrompt, attachmentsBase64 } = options || {}

          if (!prompt) {
            response = { success: false, error: 'Missing prompt' }
            break
          }

          try {
            const streamResponse = await createStreamingRequest('/generate/ephemeral', null, {
              method: 'POST',
              body: JSON.stringify({
                prompt,
                model: model || 'anthropic/claude-sonnet-4',
                maxTokens: maxTokens || 4096,
                temperature: temperature ?? 0.7,
                systemPrompt,
                attachmentsBase64,
              }),
            })

            if (!streamResponse.ok) {
              const errorText = await streamResponse.text()
              response = { success: false, error: `HTTP ${streamResponse.status}: ${errorText}` }
              break
            }

            const reader = streamResponse.body?.getReader()
            if (!reader) {
              response = { success: false, error: 'No response body' }
              break
            }

            const decoder = new TextDecoder()
            let fullText = ''
            const images: Array<{ url: string; mimeType: string }> = []
            let sseBuffer = ''

            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value, { stream: true })
              sseBuffer += chunk

              const lines = sseBuffer.split('\n')
              sseBuffer = lines.pop() || ''

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6)
                  if (data === '[DONE]') continue
                  try {
                    const parsed = JSON.parse(data)
                    if (parsed.text) {
                      fullText += parsed.text
                      iframe.contentWindow?.postMessage(
                        {
                          type: 'REQUEST_GENERATION_CHUNK',
                          requestId,
                          chunk: parsed.text,
                          text: fullText,
                        },
                        '*'
                      )
                    } else if (parsed.image) {
                      const imageData = { url: parsed.image, mimeType: parsed.mimeType || 'image/png' }
                      images.push(imageData)
                      iframe.contentWindow?.postMessage(
                        {
                          type: 'REQUEST_GENERATION_IMAGE',
                          requestId,
                          image: imageData,
                          images: [...images],
                        },
                        '*'
                      )
                    } else if (parsed.reasoning) {
                      iframe.contentWindow?.postMessage(
                        {
                          type: 'REQUEST_GENERATION_REASONING',
                          requestId,
                          reasoning: parsed.reasoning,
                        },
                        '*'
                      )
                    }
                  } catch {
                    if (data.trim()) {
                      fullText += data
                      iframe.contentWindow?.postMessage(
                        {
                          type: 'REQUEST_GENERATION_CHUNK',
                          requestId,
                          chunk: data,
                          text: fullText,
                        },
                        '*'
                      )
                    }
                  }
                }
              }
            }

            response = { success: true, text: fullText, images }
          } catch (err) {
            response = { success: false, error: String(err) }
          }
          break
        }
      }
    } catch (err) {
      response = { success: false, error: String(err) }
    }

    iframe.contentWindow?.postMessage({ type: `${type}_RESPONSE`, requestId, ...response }, '*')
  }
}

/**
 * Sets up stream event forwarding for file streaming
 */
export function setupStreamForwarding(
  getIframe: () => HTMLIFrameElement | null,
  streamState: StreamState
): (() => void)[] {
  const electronAPI = (window as any).electronAPI
  const cleanupFns: (() => void)[] = []

  const emitStreamEvent = (type: string, payload: any) => {
    const streamId = payload?.streamId
    if (!streamId) return
    const iframe = getIframe()
    iframe?.contentWindow?.postMessage({ type, ...payload }, '*')
    if (
      type === 'FS_READ_FILE_STREAM_END' ||
      type === 'FS_READ_FILE_STREAM_ERROR' ||
      type === 'FS_READ_FILE_STREAM_ABORTED'
    ) {
      streamState.targets.delete(streamId)
      streamState.pendingEvents.delete(streamId)
    }
  }

  const forwardStreamEvent = (type: string, payload: any) => {
    const streamId = payload?.streamId
    if (!streamId) return
    if (!streamState.targets.has(streamId)) {
      if (streamState.awaitingResponse > 0) {
        const pending = streamState.pendingEvents.get(streamId) || []
        pending.push({ type, payload })
        streamState.pendingEvents.set(streamId, pending)
      }
      return
    }
    emitStreamEvent(type, payload)
  }

  if (electronAPI?.fs?.onReadFileStreamChunk) {
    cleanupFns.push(
      electronAPI.fs.onReadFileStreamChunk((payload: any) => forwardStreamEvent('FS_READ_FILE_STREAM_CHUNK', payload))
    )
  }
  if (electronAPI?.fs?.onReadFileStreamProgress) {
    cleanupFns.push(
      electronAPI.fs.onReadFileStreamProgress((payload: any) =>
        forwardStreamEvent('FS_READ_FILE_STREAM_PROGRESS', payload)
      )
    )
  }
  if (electronAPI?.fs?.onReadFileStreamEnd) {
    cleanupFns.push(
      electronAPI.fs.onReadFileStreamEnd((payload: any) => forwardStreamEvent('FS_READ_FILE_STREAM_END', payload))
    )
  }
  if (electronAPI?.fs?.onReadFileStreamError) {
    cleanupFns.push(
      electronAPI.fs.onReadFileStreamError((payload: any) => forwardStreamEvent('FS_READ_FILE_STREAM_ERROR', payload))
    )
  }
  if (electronAPI?.fs?.onReadFileStreamAborted) {
    cleanupFns.push(
      electronAPI.fs.onReadFileStreamAborted((payload: any) =>
        forwardStreamEvent('FS_READ_FILE_STREAM_ABORTED', payload)
      )
    )
  }

  return cleanupFns
}

/**
 * Creates a flush function for pending stream events
 */
export function createFlushPendingEvents(
  getIframe: () => HTMLIFrameElement | null,
  streamState: StreamState
) {
  return (streamId: string) => {
    const pending = streamState.pendingEvents.get(streamId)
    if (!pending || pending.length === 0) return
    const iframe = getIframe()
    pending.forEach(entry => {
      iframe?.contentWindow?.postMessage({ type: entry.type, ...entry.payload }, '*')
    })
    streamState.pendingEvents.delete(streamId)
  }
}

/**
 * Convenience function to set up the complete message bridge
 * Returns a cleanup function
 */
export function attachMessageBridge(
  getIframe: () => HTMLIFrameElement | null,
  getUserId: () => string | null
): () => void {
  const streamState: StreamState = {
    targets: new Set(),
    pendingEvents: new Map(),
    awaitingResponse: 0,
  }

  const context: BridgeContext = { getIframe, getUserId }
  const flushPendingEvents = createFlushPendingEvents(getIframe, streamState)
  const streamCleanupFns = setupStreamForwarding(getIframe, streamState)
  const handleMessage = createMessageHandler(context, streamState, flushPendingEvents)

  window.addEventListener('message', handleMessage)

  return () => {
    window.removeEventListener('message', handleMessage)
    streamCleanupFns.forEach(cleanup => cleanup?.())
    streamState.targets.clear()
    streamState.pendingEvents.clear()
  }
}
