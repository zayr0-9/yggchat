import { getAssetPath } from '../utils/assetPath'
import { clearVideoBlobs, deleteVideoBlob, getVideoBlob, storeVideoBlob } from './videoBackgroundDb'

export interface CustomVideoEntry {
  id: string
  mimeType: string
  name: string
  size?: number
  lastModified?: number
  createdAt: number
}

export interface VideoSource {
  path: string
  type: 'video/webm' | 'video/mp4'
}

const CUSTOM_VIDEO_LIBRARY_KEY = 'yggdrasil_custom_video_library'
const CUSTOM_VIDEO_ACTIVE_KEY = 'yggdrasil_custom_video_active'
const VIDEO_BACKGROUND_EVENT = 'yggdrasil:video-background-change'

export const DEFAULT_LIGHT_VIDEO: VideoSource = {
  path: getAssetPath('video/l3.webm'),
  type: 'video/webm',
}

export const DEFAULT_DARK_VIDEO: VideoSource = {
  path: getAssetPath('video/d2.webm'),
  type: 'video/webm',
}

export const VIDEO_BACKGROUND_CHANGE_EVENT = VIDEO_BACKGROUND_EVENT

const dispatchBackgroundChange = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(VIDEO_BACKGROUND_EVENT))
}

const generateId = (): string => {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

const safeParse = (value: string | null) => {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch (error) {
    console.error('Unable to parse stored value', error)
    return null
  }
}

export const loadSavedVideos = (): CustomVideoEntry[] => {
  if (typeof window === 'undefined') return []

  const raw = safeParse(window.localStorage.getItem(CUSTOM_VIDEO_LIBRARY_KEY))
  if (!Array.isArray(raw)) return []

  return raw
}

const persistLibrary = (videos: CustomVideoEntry[]) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(CUSTOM_VIDEO_LIBRARY_KEY, JSON.stringify(videos))
    dispatchBackgroundChange()
  } catch (error) {
    console.error('Failed to persist video library', error)
    throw error
  }
}

export const loadActiveCustomVideoId = (): string | null => {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(CUSTOM_VIDEO_ACTIVE_KEY)
}

export const persistActiveCustomVideoId = (id: string | null) => {
  if (typeof window === 'undefined') return

  try {
    if (id) {
      window.localStorage.setItem(CUSTOM_VIDEO_ACTIVE_KEY, id)
    } else {
      window.localStorage.removeItem(CUSTOM_VIDEO_ACTIVE_KEY)
    }
    dispatchBackgroundChange()
  } catch (error) {
    console.error('Failed to persist active custom video id', error)
  }
}

export const loadActiveCustomVideo = (): CustomVideoEntry | null => {
  const activeId = loadActiveCustomVideoId()
  if (!activeId) return null
  const videos = loadSavedVideos()
  return videos.find(video => video.id === activeId) ?? null
}

export const addCustomVideo = async (
  params: Omit<CustomVideoEntry, 'id' | 'createdAt'> & { id?: string; blob: Blob }
): Promise<CustomVideoEntry> => {
  const videos = loadSavedVideos()
  const { blob, ...metadata } = params
  const entry: CustomVideoEntry = {
    ...metadata,
    id: params.id ?? generateId(),
    createdAt: Date.now(),
  }

  await storeVideoBlob(entry.id, blob)

  const uniqueVideos = [entry, ...videos.filter(video => video.id !== entry.id)]
  persistLibrary(uniqueVideos)

  return entry
}

export const removeCustomVideo = async (id: string) => {
  const videos = loadSavedVideos()
  const filtered = videos.filter(video => video.id !== id)
  persistLibrary(filtered)

  await deleteVideoBlob(id)

  const activeId = loadActiveCustomVideoId()
  if (activeId === id) {
    persistActiveCustomVideoId(null)
  }
}

export const clearCustomVideoLibrary = async () => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(CUSTOM_VIDEO_LIBRARY_KEY)
    persistActiveCustomVideoId(null)
    await clearVideoBlobs()
    dispatchBackgroundChange()
  } catch (error) {
    console.error('Failed to clear custom video library', error)
  }
}

export const loadCustomVideoBlobUrl = async (id: string): Promise<string | null> => {
  try {
    const blob = await getVideoBlob(id)
    if (!blob) return null
    return URL.createObjectURL(blob)
  } catch (error) {
    console.error('Failed to load video blob', error)
    return null
  }
}
