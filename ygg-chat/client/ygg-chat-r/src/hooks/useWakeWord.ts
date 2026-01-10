import { useCallback, useEffect, useRef, useState } from 'react'
import { getAssetPath } from '@/utils/assetPath'

interface UseWakeWordOptions {
  keywords?: string[]
  threshold?: number
  cooldownMs?: number
  onDetected?: (keyword: string, score: number) => void
  autoStart?: boolean
}

interface WakeWordState {
  isListening: boolean
  isLoading: boolean
  isReady: boolean
  error: string | null
  lastDetected: { keyword: string; score: number; timestamp: number } | null
}

// Singleton engine instance
let engineInstance: any = null
let enginePromise: Promise<any> | null = null

export const useWakeWord = ({
  keywords = ['hey_jarvis'],
  threshold = 0.5,
  cooldownMs = 2000,
  onDetected,
  autoStart = false,
}: UseWakeWordOptions = {}) => {
  const [state, setState] = useState<WakeWordState>({
    isListening: false,
    isLoading: false,
    isReady: false,
    error: null,
    lastDetected: null,
  })

  const onDetectedRef = useRef(onDetected)
  const engineRef = useRef<any>(null)

  // Keep callback ref in sync
  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  // Initialize the wake word engine
  const initialize = useCallback(async () => {
    if (engineInstance) {
      engineRef.current = engineInstance
      setState(prev => ({ ...prev, isReady: true }))
      return engineInstance
    }

    if (enginePromise) {
      const engine = await enginePromise
      engineRef.current = engine
      setState(prev => ({ ...prev, isReady: true }))
      return engine
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    enginePromise = (async () => {
      try {
        console.log('[WakeWord] Loading WakeWordEngine...')
        const { default: WakeWordEngine } = await import('openwakeword-wasm-browser')

        console.log('[WakeWord] Creating engine with keywords:', keywords)
        const ortWasmPath = getAssetPath('ort-wasm/');
        console.log('[WakeWord] ortWasmPath computed as:', ortWasmPath);

        const engine = new WakeWordEngine({
          baseAssetUrl: getAssetPath('openwakeword/models'),
          // Point to where Vite serves/copies WASM files (custom plugin during dev, static copy for build)
          ortWasmPath: ortWasmPath,
          keywords: keywords,
          detectionThreshold: threshold,
          cooldownMs: cooldownMs,
        })

        console.log('[WakeWord] Loading models...')
        await engine.load()
        console.log('[WakeWord] Models loaded successfully')

        // Set up detection handler
        engine.on('detect', ({ keyword, score }: { keyword: string; score: number }) => {
          console.log(`[WakeWord] Detected: ${keyword} (score: ${score.toFixed(3)})`)
          setState(prev => ({
            ...prev,
            lastDetected: { keyword, score, timestamp: Date.now() },
          }))
          onDetectedRef.current?.(keyword, score)
        })

        engineInstance = engine
        engineRef.current = engine
        setState(prev => ({ ...prev, isLoading: false, isReady: true }))
        return engine
      } catch (err) {
        console.error('[WakeWord] Failed to initialize:', err)
        const errorMsg = err instanceof Error ? err.message : 'Failed to initialize wake word engine'
        setState(prev => ({ ...prev, isLoading: false, error: errorMsg }))
        enginePromise = null
        throw err
      }
    })()

    return enginePromise
  }, [keywords, threshold, cooldownMs])

  // Start listening for wake word
  const startListening = useCallback(async () => {
    console.log('[WakeWord] startListening called')
    try {
      let engine = engineRef.current
      if (!engine) {
        engine = await initialize()
      }

      if (engine && !state.isListening) {
        console.log('[WakeWord] Starting engine...')
        await engine.start()
        setState(prev => ({ ...prev, isListening: true, error: null }))
        console.log('[WakeWord] Engine started, listening for wake word')
      }
    } catch (err) {
      console.error('[WakeWord] Failed to start:', err)
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to start wake word detection',
      }))
    }
  }, [initialize, state.isListening])

  // Stop listening
  const stopListening = useCallback(() => {
    console.log('[WakeWord] stopListening called')
    const engine = engineRef.current
    if (engine && state.isListening) {
      engine.stop()
      setState(prev => ({ ...prev, isListening: false }))
      console.log('[WakeWord] Engine stopped')
    }
  }, [state.isListening])

  // Toggle listening
  const toggleListening = useCallback(() => {
    if (state.isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [state.isListening, startListening, stopListening])

  // Auto-start if enabled
  useEffect(() => {
    if (autoStart) {
      startListening()
    }

    return () => {
      // Don't destroy the engine on unmount - it's a singleton
      // Just stop listening
      if (engineRef.current && state.isListening) {
        engineRef.current.stop()
      }
    }
  }, [autoStart])

  return {
    ...state,
    startListening,
    stopListening,
    toggleListening,
    initialize,
  }
}
