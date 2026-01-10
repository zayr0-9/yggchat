import { useCallback, useEffect, useRef, useState } from 'react'
import { getAssetPath } from '@/utils/assetPath'

interface UseWhisperSpeechToTextOptions {
  onTranscript?: (transcript: string) => void
  onFinalTranscript?: (transcript: string) => void
  language?: string
  model?: 'tiny' | 'base' | 'small'
  silenceThreshold?: number // seconds of silence before auto-stopping
}

interface WhisperState {
  isLoading: boolean
  isModelLoaded: boolean
  loadProgress: number
  error: string | null
}

// Singleton for the pipeline to avoid reloading the model
let pipelinePromise: Promise<any> | null = null
let pipelineInstance: any = null
let configuredEnv = false

const loadWhisperPipeline = async (
  model: string,
  onProgress?: (progress: number) => void
): Promise<any> => {
  if (pipelineInstance) {
    return pipelineInstance
  }

  if (pipelinePromise) {
    return pipelinePromise
  }

  pipelinePromise = (async () => {
    console.log('[Whisper] Loading transformers.js...')
    const transformers = await import('@huggingface/transformers')
    const { pipeline, env } = transformers

    // Configure environment for proper model loading
    if (!configuredEnv) {
      // Use local models from public/models/ directory
      env.allowLocalModels = true
      env.allowRemoteModels = false // Disable remote to avoid CDN issues
      env.localModelPath = getAssetPath('models/') // Relative to public folder

      // Use browser cache for any cached data
      env.useBrowserCache = true

      console.log('[Whisper] Transformers environment:', env);

      // Configure WASM paths
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = getAssetPath('ort-wasm/');
        console.log('[Whisper] Set WASM paths to:', env.backends.onnx.wasm.wasmPaths);
      } else {
        console.warn('[Whisper] env.backends.onnx.wasm is missing!');
      }

      console.log('[Whisper] Environment configured for LOCAL models:', {
        allowLocalModels: env.allowLocalModels,
        allowRemoteModels: env.allowRemoteModels,
        localModelPath: env.localModelPath,
      })
      configuredEnv = true
    }

    // Use local path: /models/whisper-tiny (served from public/models/whisper-tiny)
    const modelId = `whisper-${model}`
    console.log(`[Whisper] Loading model: ${modelId}...`)

    try {
      const pipe = await pipeline('automatic-speech-recognition', modelId, {
        progress_callback: (data: any) => {
          if (data.status === 'progress' && data.progress) {
            console.log(`[Whisper] Loading ${data.file}: ${data.progress.toFixed(1)}%`)
            onProgress?.(data.progress)
          } else if (data.status === 'done') {
            console.log(`[Whisper] Loaded: ${data.file}`)
          } else if (data.status === 'initiate') {
            console.log(`[Whisper] Starting: ${data.file}`)
          }
        },
        // Explicitly set quantized model for smaller size
        // quantized: true,
      })

      console.log('[Whisper] Model loaded successfully')
      pipelineInstance = pipe
      return pipe
    } catch (loadError) {
      console.error('[Whisper] Pipeline load error:', loadError)
      // Reset promise so user can retry
      pipelinePromise = null
      throw loadError
    }
  })()

  return pipelinePromise
}

export const useWhisperSpeechToText = ({
  onTranscript,
  onFinalTranscript,
  language = 'en',
  model = 'tiny',
  silenceThreshold = 2,
}: UseWhisperSpeechToTextOptions = {}) => {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [whisperState, setWhisperState] = useState<WhisperState>({
    isLoading: false,
    isModelLoaded: !!pipelineInstance,
    loadProgress: 0,
    error: null,
  })

  // Refs for callbacks
  const onTranscriptRef = useRef(onTranscript)
  const onFinalTranscriptRef = useRef(onFinalTranscript)

  // Audio recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const isProcessingRef = useRef(false)

  // Keep refs in sync
  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onFinalTranscriptRef.current = onFinalTranscript
  }, [onTranscript, onFinalTranscript])

  // Preload model on mount (optional - can be triggered manually)
  const preloadModel = useCallback(async () => {
    if (pipelineInstance) {
      setWhisperState(prev => ({ ...prev, isModelLoaded: true }))
      return
    }

    setWhisperState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      await loadWhisperPipeline(model, progress => {
        setWhisperState(prev => ({ ...prev, loadProgress: progress }))
      })
      setWhisperState(prev => ({ ...prev, isLoading: false, isModelLoaded: true, loadProgress: 100 }))
    } catch (err) {
      console.error('[Whisper] Failed to load model:', err)
      setWhisperState(prev => ({
        ...prev,
        isLoading: false,
        error: `Failed to load model: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }))
    }
  }, [model])

  // Convert audio blob to the format Whisper expects
  const processAudio = useCallback(async (audioBlob: Blob): Promise<string> => {
    console.log('[Whisper] Processing audio blob:', audioBlob.size, 'bytes')

    if (audioBlob.size < 1000) {
      console.log('[Whisper] Audio too short, skipping')
      return ''
    }

    const pipe = await loadWhisperPipeline(model, progress => {
      setWhisperState(prev => ({ ...prev, loadProgress: progress }))
    })
    setWhisperState(prev => ({ ...prev, isModelLoaded: true }))

    // Convert blob to array buffer
    const arrayBuffer = await audioBlob.arrayBuffer()

    // Decode audio using Web Audio API
    const audioContext = new AudioContext({ sampleRate: 16000 })
    let audioBuffer: AudioBuffer

    try {
      audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    } catch (decodeError) {
      console.error('[Whisper] Failed to decode audio:', decodeError)
      audioContext.close()
      return ''
    }

    // Get audio data as Float32Array (mono, 16kHz)
    const audioData = audioBuffer.getChannelData(0)
    console.log('[Whisper] Audio data length:', audioData.length, 'samples')

    // Run transcription
    console.log('[Whisper] Running transcription...')
    const startTime = performance.now()

    const result = await pipe(audioData, {
      language,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
    })

    const elapsed = performance.now() - startTime
    console.log(`[Whisper] Transcription completed in ${elapsed.toFixed(0)}ms:`, result.text)

    audioContext.close()
    return result.text || ''
  }, [model, language])

  // Start recording
  const startListening = useCallback(async () => {
    console.log('[Whisper] startListening called')

    if (isListening || isProcessingRef.current) {
      console.log('[Whisper] Already listening or processing')
      return
    }

    try {
      // Request microphone access
      console.log('[Whisper] Requesting microphone access...')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream
      console.log('[Whisper] Microphone access granted')

      // Set up audio analysis for silence detection
      audioContextRef.current = new AudioContext()
      const source = audioContextRef.current.createMediaStreamSource(stream)
      analyserRef.current = audioContextRef.current.createAnalyser()
      analyserRef.current.fftSize = 2048
      source.connect(analyserRef.current)

      // Create MediaRecorder
      // Try to use a format that's easier to decode
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4'

      console.log('[Whisper] Using MIME type:', mimeType)

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
          console.log('[Whisper] Audio chunk received:', event.data.size, 'bytes')
        }
      }

      mediaRecorder.onstop = async () => {
        console.log('[Whisper] MediaRecorder stopped, processing audio...')
        isProcessingRef.current = true

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        console.log('[Whisper] Total audio size:', audioBlob.size, 'bytes')

        try {
          const text = await processAudio(audioBlob)
          if (text.trim()) {
            setTranscript(text)
            onTranscriptRef.current?.(text)
            onFinalTranscriptRef.current?.(text)
          }
        } catch (err) {
          console.error('[Whisper] Transcription error:', err)
          setWhisperState(prev => ({
            ...prev,
            error: `Transcription failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          }))
        } finally {
          isProcessingRef.current = false
        }
      }

      // Start recording
      mediaRecorder.start(1000) // Collect data every second
      setIsListening(true)
      setWhisperState(prev => ({ ...prev, error: null }))
      console.log('[Whisper] Recording started')

      // Optional: Set up silence detection
      // This will auto-stop after silenceThreshold seconds of silence
      const checkSilence = () => {
        if (!analyserRef.current || !isListening) return

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(dataArray)

        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        const isSilent = average < 10 // Adjust threshold as needed

        if (isSilent) {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              console.log('[Whisper] Silence detected, stopping...')
              stopListening()
            }, silenceThreshold * 1000)
          }
        } else {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }
        }
      }

      // Start silence detection loop
      const silenceCheckInterval = setInterval(checkSilence, 200)

        // Store interval for cleanup
        ; (mediaRecorder as any)._silenceCheckInterval = silenceCheckInterval
    } catch (err) {
      console.error('[Whisper] Failed to start recording:', err)
      setWhisperState(prev => ({
        ...prev,
        error: `Microphone access failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }))
    }
  }, [isListening, processAudio, silenceThreshold])

  // Stop recording
  const stopListening = useCallback(() => {
    console.log('[Whisper] stopListening called')

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }

    if (mediaRecorderRef.current) {
      const interval = (mediaRecorderRef.current as any)._silenceCheckInterval
      if (interval) {
        clearInterval(interval)
      }

      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      mediaRecorderRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    setIsListening(false)
    console.log('[Whisper] Recording stopped')
  }, [])

  // Toggle listening
  const toggleListening = useCallback(() => {
    console.log('[Whisper] toggleListening called, isListening:', isListening)
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current)
      }
      if (mediaRecorderRef.current) {
        const interval = (mediaRecorderRef.current as any)._silenceCheckInterval
        if (interval) {
          clearInterval(interval)
        }
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop()
        }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [])

  return {
    isListening,
    transcript,
    error: whisperState.error,
    isLoading: whisperState.isLoading,
    isModelLoaded: whisperState.isModelLoaded,
    loadProgress: whisperState.loadProgress,
    startListening,
    stopListening,
    toggleListening,
    preloadModel,
    setTranscript,
    isProcessing: isProcessingRef.current,
  }
}
