import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSpeechToTextOptions {
  onTranscript?: (transcript: string) => void
  onFinalTranscript?: (transcript: string) => void
  language?: string
  continuous?: boolean
  interimResults?: boolean
}

export const useSpeechToText = ({
  onTranscript,
  onFinalTranscript,
  language = 'en-US',
  continuous = true,
  interimResults = true,
}: UseSpeechToTextOptions = {}) => {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<any>(null)

  // Use refs for callbacks to avoid re-creating recognition on callback changes
  const onTranscriptRef = useRef(onTranscript)
  const onFinalTranscriptRef = useRef(onFinalTranscript)

  // Keep refs in sync with latest callbacks
  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onFinalTranscriptRef.current = onFinalTranscript
  }, [onTranscript, onFinalTranscript])

  useEffect(() => {
    console.log('[SpeechToText] Initializing speech recognition...')
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.error('[SpeechToText] Speech Recognition API not supported')
      setError('Speech Recognition API not supported in this browser.')
      return
    }
    console.log('[SpeechToText] SpeechRecognition API found:', SpeechRecognition.name || 'webkitSpeechRecognition')

    const recognition = new SpeechRecognition()
    recognition.continuous = continuous
    recognition.interimResults = interimResults
    recognition.lang = language
    console.log('[SpeechToText] Config:', { continuous, interimResults, language })

    recognition.onstart = () => {
      console.log('[SpeechToText] Recognition started')
      setIsListening(true)
      setError(null)
    }

    recognition.onerror = (event: any) => {
      console.error('[SpeechToText] Recognition error:', event.error, event)
      setError(event.error)
      setIsListening(false)
    }

    recognition.onend = () => {
      console.log('[SpeechToText] Recognition ended')
      setIsListening(false)
    }

    recognition.onnomatch = () => {
      console.log('[SpeechToText] No speech match detected')
    }

    recognition.onsoundstart = () => {
      console.log('[SpeechToText] Sound detected')
    }

    recognition.onsoundend = () => {
      console.log('[SpeechToText] Sound ended')
    }

    recognition.onspeechstart = () => {
      console.log('[SpeechToText] Speech detected')
    }

    recognition.onspeechend = () => {
      console.log('[SpeechToText] Speech ended')
    }

    recognition.onresult = (event: any) => {
      console.log('[SpeechToText] Result received:', event.results)
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcriptSegment = event.results[i][0].transcript
        const confidence = event.results[i][0].confidence
        console.log('[SpeechToText] Segment:', { transcriptSegment, isFinal: event.results[i].isFinal, confidence })

        if (event.results[i].isFinal) {
          finalTranscript += transcriptSegment
          if (onFinalTranscriptRef.current) onFinalTranscriptRef.current(transcriptSegment)
        } else {
          interimTranscript += transcriptSegment
        }
      }

      const fullTranscript = finalTranscript || interimTranscript
      setTranscript(fullTranscript)
      if (onTranscriptRef.current) onTranscriptRef.current(fullTranscript)
    }

    recognitionRef.current = recognition
    console.log('[SpeechToText] Recognition instance created and ready')

    return () => {
      console.log('[SpeechToText] Cleanup: stopping recognition')
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [language, continuous, interimResults]) // Removed callback deps - using refs instead

  const startListening = useCallback(() => {
    console.log('[SpeechToText] startListening called, isListening:', isListening, 'recognitionRef:', !!recognitionRef.current)
    if (recognitionRef.current && !isListening) {
      try {
        console.log('[SpeechToText] Calling recognition.start()...')
        recognitionRef.current.start()
      } catch (err) {
        console.error('[SpeechToText] Failed to start speech recognition:', err)
      }
    } else {
      console.log('[SpeechToText] Cannot start:', { hasRecognition: !!recognitionRef.current, isListening })
    }
  }, [isListening])

  const stopListening = useCallback(() => {
    console.log('[SpeechToText] stopListening called, isListening:', isListening)
    if (recognitionRef.current && isListening) {
      console.log('[SpeechToText] Calling recognition.stop()...')
      recognitionRef.current.stop()
    }
  }, [isListening])

  const toggleListening = useCallback(() => {
    console.log('[SpeechToText] toggleListening called, current isListening:', isListening)
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  }, [isListening, startListening, stopListening])

  return {
    isListening,
    transcript,
    error,
    startListening,
    stopListening,
    toggleListening,
    setTranscript
  }
}
