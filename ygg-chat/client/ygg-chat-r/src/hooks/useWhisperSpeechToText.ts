import { getAssetPath } from '@/utils/assetPath'
import { useCallback, useEffect, useRef, useState } from 'react'

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

const loadWhisperPipeline = async (model: string, onProgress?: (progress: number) => void): Promise<any> => {
  if (pipelineInstance) {
    return pipelineInstance
  }

  if (pipelinePromise) {
    return pipelinePromise
  }

  pipelinePromise = (async () => {
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

      // Configure WASM paths
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.wasmPaths = getAssetPath('ort-wasm/')
      } else {
        console.warn('[Whisper] env.backends.onnx.wasm is missing!')
      }

      configuredEnv = true
    }

    // Use local path: /models/whisper-tiny (served from public/models/whisper-tiny)
    const modelId = `whisper-${model}`

    try {
      const pipe = await pipeline('automatic-speech-recognition', modelId, {
        progress_callback: (data: any) => {
          if (data.status === 'progress' && data.progress) {
            onProgress?.(data.progress)
          }
        },
        // Explicitly set quantized model for smaller size
        // quantized: true,
      })

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
  const processAudio = useCallback(
    async (audioBlob: Blob): Promise<string> => {
      if (audioBlob.size < 1000) {
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

      // Run transcription

      const result = await pipe(audioData, {
        language,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      })

      audioContext.close()
      return result.text || ''
    },
    [model, language]
  )

  // Start recording
  const startListening = useCallback(async () => {
    if (isListening || isProcessingRef.current) {
      return
    }

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream

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

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        isProcessingRef.current = true

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })

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
      ;(mediaRecorder as any)._silenceCheckInterval = silenceCheckInterval
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
  }, [])

  // Toggle listening
  const toggleListening = useCallback(() => {
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
