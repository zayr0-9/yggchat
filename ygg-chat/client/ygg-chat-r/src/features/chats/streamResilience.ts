export interface StreamRetryPolicy {
  requestTimeoutMs: number
  firstByteTimeoutMs: number
  maxRetries: number
  baseBackoffMs: number
  maxBackoffMs: number
  jitterRatio: number
}

export const STREAM_RETRY_POLICY: StreamRetryPolicy = {
  requestTimeoutMs: 45000,
  firstByteTimeoutMs: 45000,
  maxRetries: 3,
  baseBackoffMs: 500,
  maxBackoffMs: 5000,
  jitterRatio: 0.25,
}

export interface OpenStreamingWithPreFirstByteRetryParams {
  endpoint: string
  conversationId?: string | null
  streamId?: string | null
  parentSignal?: AbortSignal
  policy?: Partial<StreamRetryPolicy>
  openAttempt: (signal: AbortSignal, attempt: number) => Promise<Response>
}

export interface OpenStreamingWithPreFirstByteRetryResult {
  response: Response
  reader: ReadableStreamDefaultReader<Uint8Array> | null
  firstRead: ReadableStreamReadResult<Uint8Array> | null
  attempt: number
}

const isAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    return error.name === 'AbortError'
  }
  return typeof error === 'object' && error !== null && (error as any).name === 'AbortError'
}

const createAbortError = (): Error => {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation was aborted.', 'AbortError')
  }
  const error = new Error('The operation was aborted.')
  ;(error as any).name = 'AbortError'
  return error
}

const mergePolicy = (policy?: Partial<StreamRetryPolicy>): StreamRetryPolicy => ({
  ...STREAM_RETRY_POLICY,
  ...(policy || {}),
})

const isRetryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500

const jitteredBackoff = (attempt: number, policy: StreamRetryPolicy): number => {
  const exponential = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * 2 ** Math.max(0, attempt - 1))
  const jitterWindow = Math.max(0, exponential * policy.jitterRatio)
  const jitter = Math.floor(Math.random() * (jitterWindow + 1))
  return exponential + jitter
}

const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    const timeoutId = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timeoutId)
      cleanup()
      reject(createAbortError())
    }

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })

const logAttemptWarning = (params: {
  endpoint: string
  conversationId?: string | null
  streamId?: string | null
  attempt: number
  maxRetries: number
  failureClass: string
  elapsedMs: number
  status?: number
  nextDelayMs?: number
  exhausted?: boolean
  error?: string
}) => {
  console.warn('[stream-resilience] pre-first-byte retry event', params)
}

const createLinkedAttemptController = (parentSignal?: AbortSignal): {
  controller: AbortController
  cleanup: () => void
} => {
  const controller = new AbortController()

  if (!parentSignal) {
    return { controller, cleanup: () => {} }
  }

  const onParentAbort = () => controller.abort()
  parentSignal.addEventListener('abort', onParentAbort, { once: true })

  return {
    controller,
    cleanup: () => {
      parentSignal.removeEventListener('abort', onParentAbort)
    },
  }
}

export const openStreamingWithPreFirstByteRetry = async (
  params: OpenStreamingWithPreFirstByteRetryParams
): Promise<OpenStreamingWithPreFirstByteRetryResult> => {
  const { endpoint, conversationId, streamId, parentSignal, openAttempt } = params
  const policy = mergePolicy(params.policy)
  const totalAttempts = policy.maxRetries + 1

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (parentSignal?.aborted) {
      throw createAbortError()
    }

    const startedAt = Date.now()
    const canRetry = attempt <= policy.maxRetries
    const { controller: attemptController, cleanup: unlinkParentAbort } = createLinkedAttemptController(parentSignal)

    let requestTimeoutTriggered = false
    let firstByteTimeoutTriggered = false
    let requestTimer: ReturnType<typeof setTimeout> | null = null
    let firstByteTimer: ReturnType<typeof setTimeout> | null = null
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

    try {
      requestTimer = setTimeout(() => {
        requestTimeoutTriggered = true
        attemptController.abort()
      }, policy.requestTimeoutMs)

      const response = await openAttempt(attemptController.signal, attempt)

      if (requestTimer) {
        clearTimeout(requestTimer)
        requestTimer = null
      }

      if (!response.ok) {
        if (isRetryableStatus(response.status) && canRetry) {
          const nextDelayMs = jitteredBackoff(attempt, policy)
          logAttemptWarning({
            endpoint,
            conversationId,
            streamId,
            attempt,
            maxRetries: policy.maxRetries,
            failureClass: 'retryable_status',
            elapsedMs: Date.now() - startedAt,
            status: response.status,
            nextDelayMs,
          })
          await response.body?.cancel().catch(() => {})
          await sleepWithAbort(nextDelayMs, parentSignal)
          continue
        }

        if (isRetryableStatus(response.status)) {
          logAttemptWarning({
            endpoint,
            conversationId,
            streamId,
            attempt,
            maxRetries: policy.maxRetries,
            failureClass: 'retryable_status',
            elapsedMs: Date.now() - startedAt,
            status: response.status,
            exhausted: true,
          })
        }

        return { response, reader: null, firstRead: null, attempt }
      }

      reader = response.body?.getReader() || null
      if (!reader) {
        if (canRetry) {
          const nextDelayMs = jitteredBackoff(attempt, policy)
          logAttemptWarning({
            endpoint,
            conversationId,
            streamId,
            attempt,
            maxRetries: policy.maxRetries,
            failureClass: 'missing_reader',
            elapsedMs: Date.now() - startedAt,
            nextDelayMs,
          })
          await sleepWithAbort(nextDelayMs, parentSignal)
          continue
        }

        logAttemptWarning({
          endpoint,
          conversationId,
          streamId,
          attempt,
          maxRetries: policy.maxRetries,
          failureClass: 'missing_reader',
          elapsedMs: Date.now() - startedAt,
          exhausted: true,
        })

        throw new Error('No stream reader available')
      }

      firstByteTimer = setTimeout(() => {
        firstByteTimeoutTriggered = true
        attemptController.abort()
      }, policy.firstByteTimeoutMs)

      const firstRead = await reader.read()

      if (firstByteTimer) {
        clearTimeout(firstByteTimer)
        firstByteTimer = null
      }

      if (firstRead.done) {
        const error = new Error('Stream ended before first SSE byte')
        if (canRetry) {
          const nextDelayMs = jitteredBackoff(attempt, policy)
          logAttemptWarning({
            endpoint,
            conversationId,
            streamId,
            attempt,
            maxRetries: policy.maxRetries,
            failureClass: 'empty_stream',
            elapsedMs: Date.now() - startedAt,
            nextDelayMs,
          })
          await reader.cancel().catch(() => {})
          reader = null
          await sleepWithAbort(nextDelayMs, parentSignal)
          continue
        }

        logAttemptWarning({
          endpoint,
          conversationId,
          streamId,
          attempt,
          maxRetries: policy.maxRetries,
          failureClass: 'empty_stream',
          elapsedMs: Date.now() - startedAt,
          exhausted: true,
        })

        throw error
      }

      return {
        response,
        reader,
        firstRead,
        attempt,
      }
    } catch (error) {
      if (requestTimer) clearTimeout(requestTimer)
      if (firstByteTimer) clearTimeout(firstByteTimer)

      if (reader) {
        await reader.cancel().catch(() => {})
      }

      if (parentSignal?.aborted) {
        throw createAbortError()
      }

      const failureClass = requestTimeoutTriggered
        ? 'request_timeout'
        : firstByteTimeoutTriggered
          ? 'first_byte_timeout'
          : isAbortError(error)
            ? 'attempt_aborted'
            : 'request_error'
      const isNonRetryableAbort = isAbortError(error) && !requestTimeoutTriggered && !firstByteTimeoutTriggered

      if (!canRetry || isNonRetryableAbort) {
        const shouldLogTerminal =
          !isAbortError(error) || requestTimeoutTriggered || firstByteTimeoutTriggered
        if (shouldLogTerminal) {
          logAttemptWarning({
            endpoint,
            conversationId,
            streamId,
            attempt,
            maxRetries: policy.maxRetries,
            failureClass,
            elapsedMs: Date.now() - startedAt,
            exhausted: true,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        throw error
      }

      const nextDelayMs = jitteredBackoff(attempt, policy)
      logAttemptWarning({
        endpoint,
        conversationId,
        streamId,
        attempt,
        maxRetries: policy.maxRetries,
        failureClass,
        elapsedMs: Date.now() - startedAt,
        nextDelayMs,
        error: error instanceof Error ? error.message : String(error),
      })
      await sleepWithAbort(nextDelayMs, parentSignal)
    } finally {
      if (requestTimer) clearTimeout(requestTimer)
      if (firstByteTimer) clearTimeout(firstByteTimer)
      unlinkParentAbort()
    }
  }

  throw new Error('Failed to open streaming response')
}
