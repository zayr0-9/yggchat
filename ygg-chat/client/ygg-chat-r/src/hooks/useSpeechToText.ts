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
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.error('[SpeechToText] Speech Recognition API not supported')
      setError('Speech Recognition API not supported in this browser.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = continuous
    recognition.interimResults = interimResults
    recognition.lang = language

    recognition.onstart = () => {
      setIsListening(true)
      setError(null)
    }

    recognition.onerror = (event: any) => {
      setError(event.error)
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognition.onnomatch = () => {}

    recognition.onsoundstart = () => {}

    recognition.onsoundend = () => {}

    recognition.onspeechstart = () => {}

    recognition.onspeechend = () => {}

    recognition.onresult = (event: any) => {
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcriptSegment = event.results[i][0].transcript

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

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [language, continuous, interimResults]) // Removed callback deps - using refs instead

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      try {
        recognitionRef.current.start()
      } catch (err) {
        console.error('[SpeechToText] Failed to start speech recognition:', err)
      }
    }
  }, [isListening])

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop()
    }
  }, [isListening])

  const toggleListening = useCallback(() => {
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
    setTranscript,
  }
}
