import React, { useEffect, useState } from 'react'
import {
  BackgroundColorSettings,
  BackgroundMode,
  CustomVideoEntry,
  DEFAULT_LIGHT_VIDEO,
  getActiveTextColorMode,
  loadActiveCustomVideo,
  loadActiveCustomVideoId,
  loadBackgroundColors,
  loadBackgroundMode,
  loadCustomVideoBlobUrl,
  VIDEO_BACKGROUND_CHANGE_EVENT,
} from '../helpers/videoBackgroundStorage'

const VideoBackground: React.FC = () => {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(() => loadActiveCustomVideoId())
  const [activeVideoMeta, setActiveVideoMeta] = useState<CustomVideoEntry | null>(() => loadActiveCustomVideo())
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null)
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() => loadBackgroundMode())
  const [backgroundColors, setBackgroundColors] = useState<BackgroundColorSettings>(() => loadBackgroundColors())
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.classList.contains('dark')
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleBackgroundChange = () => {
      setActiveVideoId(loadActiveCustomVideoId())
      setActiveVideoMeta(loadActiveCustomVideo())
      setBackgroundMode(loadBackgroundMode())
      setBackgroundColors(loadBackgroundColors())
    }

    window.addEventListener(VIDEO_BACKGROUND_CHANGE_EVENT, handleBackgroundChange)
    return () => window.removeEventListener(VIDEO_BACKGROUND_CHANGE_EVENT, handleBackgroundChange)
  }, [])

  useEffect(() => {
    if (backgroundMode !== 'video') {
      setActiveVideoUrl(null)
      return
    }

    let isMounted = true
    let objectUrl: string | null = null

    const loadBlobUrl = async () => {
      if (!activeVideoId) {
        setActiveVideoUrl(null)
        return
      }

      const blobUrl = await loadCustomVideoBlobUrl(activeVideoId)
      if (!isMounted) {
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl)
        }
        return
      }

      if (objectUrl && objectUrl !== blobUrl) {
        URL.revokeObjectURL(objectUrl)
      }
      objectUrl = blobUrl
      setActiveVideoUrl(blobUrl)
    }

    loadBlobUrl()

    return () => {
      isMounted = false
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [activeVideoId, backgroundMode])

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return

    const root = document.documentElement
    const updateTheme = () => {
      setIsDarkTheme(root.classList.contains('dark'))
    }

    updateTheme()

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class') {
          updateTheme()
          break
        }
      }
    })

    observer.observe(root, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [])

  // Set CSS class on document root based on video's text color mode
  useEffect(() => {
    if (typeof document === 'undefined') return

    const root = document.documentElement
    const textColorMode =
      backgroundMode === 'video' ? getActiveTextColorMode() : isDarkTheme ? 'light' : 'dark'

    root.classList.remove('video-text-light', 'video-text-dark')

    if (textColorMode === 'light') {
      root.classList.add('video-text-light')
    } else if (textColorMode === 'dark') {
      root.classList.add('video-text-dark')
    }

    return () => {
      root.classList.remove('video-text-light', 'video-text-dark')
    }
  }, [activeVideoMeta, backgroundMode, isDarkTheme])

  const sourceForMode = (
    customUrl: string | null,
    custom: CustomVideoEntry | null,
    fallback: { path: string; type: 'video/webm' | 'video/mp4' }
  ) => {
    if (custom && customUrl) {
      return { src: customUrl, type: custom.mimeType }
    }
    return { src: fallback.path, type: fallback.type }
  }

  const lightSource = sourceForMode(activeVideoUrl, activeVideoMeta, DEFAULT_LIGHT_VIDEO)
  const colorBackgroundColor = isDarkTheme ? backgroundColors.dark : backgroundColors.light

  if (backgroundMode === 'color') {
    return (
      <div
        key={colorBackgroundColor}
        className='fixed inset-0 w-full h-full pointer-events-none -z-10 transition-colors duration-300'
        style={{ backgroundColor: colorBackgroundColor }}
        aria-hidden='true'
      />
    )
  }

  return (
    <video
      key={lightSource.src}
      autoPlay
      loop
      muted
      className='fixed inset-0 w-full h-full blur-[0px] dark:blur-[1px] 2xl:dark:blur-[1px] 2xl:dark:blur-[1px] object-cover pointer-events-none -z-10'
      aria-hidden='true'
    >
      <source src={lightSource.src} type={lightSource.type} />
    </video>
  )
}

export default VideoBackground
