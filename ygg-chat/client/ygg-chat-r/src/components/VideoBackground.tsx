import React, { useEffect, useState } from 'react'
import {
  CustomVideoEntry,
  DEFAULT_LIGHT_VIDEO,
  getActiveTextColorMode,
  loadActiveCustomVideo,
  loadActiveCustomVideoId,
  loadCustomVideoBlobUrl,
  VIDEO_BACKGROUND_CHANGE_EVENT,
} from '../helpers/videoBackgroundStorage'

const VideoBackground: React.FC = () => {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(() => loadActiveCustomVideoId())
  const [activeVideoMeta, setActiveVideoMeta] = useState<CustomVideoEntry | null>(() => loadActiveCustomVideo())
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleBackgroundChange = () => {
      setActiveVideoId(loadActiveCustomVideoId())
      setActiveVideoMeta(loadActiveCustomVideo())
    }

    window.addEventListener(VIDEO_BACKGROUND_CHANGE_EVENT, handleBackgroundChange)
    return () => window.removeEventListener(VIDEO_BACKGROUND_CHANGE_EVENT, handleBackgroundChange)
  }, [])

  useEffect(() => {
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
  }, [activeVideoId])

  // Set CSS class on document root based on video's text color mode
  useEffect(() => {
    if (typeof document === 'undefined') return

    const root = document.documentElement
    const textColorMode = getActiveTextColorMode()

    // Remove existing video text color classes
    root.classList.remove('video-text-light', 'video-text-dark')

    // Add class based on text color mode (only if not 'auto')
    if (textColorMode === 'light') {
      root.classList.add('video-text-light')
    } else if (textColorMode === 'dark') {
      root.classList.add('video-text-dark')
    }

    return () => {
      root.classList.remove('video-text-light', 'video-text-dark')
    }
  }, [activeVideoMeta])

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
  // const darkSource = sourceForMode(activeVideoUrl, activeVideoMeta, DEFAULT_DARK_VIDEO)

  return (
    <>
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
      {/* <video
        key={darkSource.src}
        autoPlay
        loop
        muted
        className='fixed w-full h-full blur-[1px] dark:blur-[1px] 2xl:dark:blur-[1px] 2xl:dark:blur-[1px] object-cover pointer-events-none -z-10 hidden dark:block'
        aria-hidden='true'
      >
        <source src={darkSource.src} type={darkSource.type} />
      </video> */}
    </>
  )
}

export default VideoBackground
