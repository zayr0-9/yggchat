import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components'
import {
  CustomVideoEntry,
  addCustomVideo,
  clearCustomVideoLibrary,
  loadActiveCustomVideoId,
  loadSavedVideos,
  persistActiveCustomVideoId,
  removeCustomVideo,
  VIDEO_BACKGROUND_CHANGE_EVENT,
} from '../helpers/videoBackgroundStorage'

const MAX_UPLOAD_SIZE_BYTES = 8 * 1024 * 1024 // 8MB

type StatusMessage = {
  type: 'success' | 'error' | 'info'
  text: string
}

const formatSize = (size?: number) => {
  if (!size) {
    return 'n/a'
  }

  if (size < 1024) {
    return `${size.toFixed(0)} bytes`
  }

  const kilo = size / 1024
  if (kilo < 1024) {
    return `${kilo.toFixed(1)} KB`
  }

  return `${(kilo / 1024).toFixed(1)} MB`
}

const Settings: React.FC = () => {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const [videos, setVideos] = useState<CustomVideoEntry[]>(() => loadSavedVideos())
  const [activeVideoId, setActiveVideoId] = useState<string | null>(() => loadActiveCustomVideoId())
  const [uploading, setUploading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)

  useEffect(() => {
    const handleBackgroundChange = () => {
      setVideos(loadSavedVideos())
      setActiveVideoId(loadActiveCustomVideoId())
    }

    window.addEventListener(VIDEO_BACKGROUND_CHANGE_EVENT, handleBackgroundChange)
    return () => window.removeEventListener(VIDEO_BACKGROUND_CHANGE_EVENT, handleBackgroundChange)
  }, [])

  const showStatus = (message: StatusMessage) => {
    setStatusMessage(message)
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = window.setTimeout(() => setStatusMessage(null), 4000)
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    if (!['video/mp4', 'video/webm'].includes(file.type)) {
      showStatus({ type: 'error', text: 'Video must be in MP4 or WebM format.' })
      return
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      showStatus({ type: 'error', text: 'File must be smaller than 8MB to keep localStorage responsive.' })
      return
    }

    setUploading(true)

    try {
      const entry = await addCustomVideo({
        mimeType: file.type,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        blob: file,
      })

      persistActiveCustomVideoId(entry.id)
      setVideos(loadSavedVideos())
      setActiveVideoId(entry.id)
      showStatus({ type: 'success', text: 'Custom video saved and activated.' })
    } catch (error) {
      console.error(error)
      showStatus({ type: 'error', text: 'Unable to save the custom video. Try again.' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleSelectVideo = (id: string) => {
    persistActiveCustomVideoId(id)
    setActiveVideoId(id)
    showStatus({ type: 'success', text: 'Active background updated.' })
  }

  const handleRemoveVideo = (id: string) => {
    removeCustomVideo(id)
    setVideos(loadSavedVideos())
    if (activeVideoId === id) {
      setActiveVideoId(null)
    }
    showStatus({ type: 'info', text: 'Video removed from gallery.' })
  }

  const handleClearGallery = () => {
    clearCustomVideoLibrary()
    setVideos([])
    setActiveVideoId(null)
    showStatus({ type: 'success', text: 'Gallery cleared. Default wallpapers will be used.' })
  }

  const handleResetToDefault = () => {
    persistActiveCustomVideoId(null)
    setActiveVideoId(null)
    showStatus({ type: 'success', text: 'Reverted to the built-in defaults.' })
  }

  const renderStatus = () => {
    if (!statusMessage) return null

    const colors = {
      success:
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:border-emerald-800 dark:text-emerald-200',
      error: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-900/40 dark:border-rose-800 dark:text-rose-200',
      info: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-900/40 dark:border-sky-800 dark:text-sky-200',
    }

    return (
      <div className={`rounded-lg border px-4 py-2 text-sm ${colors[statusMessage.type]}`}>{statusMessage.text}</div>
    )
  }

  return (
    <div className='h-full overflow-y-auto bg-neutral-100 mica min-h-full dark:bg-yBlack-900'>
      <div className='mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <div>
            <p className='text-sm uppercase tracking-[0.3em] text-stone-400 dark:text-stone-500'>Background</p>
            <h1 className='text-3xl font-semibold text-stone-800 dark:text-stone-100'>Video Wallpaper Studio</h1>
            <p className='mt-1 text-sm text-stone-500 dark:text-stone-400'>
              Upload up to 8MB MP4/WebM clips and switch between them in one place.
            </p>
          </div>
          <Button variant='secondary' onClick={() => navigate('/homepage')} className='group'>
            <p className='transition-transform duration-100 group-active:scale-95'>Back to Home</p>
          </Button>
        </header>

        {renderStatus()}

        <section className='rounded-2xl border border-neutral-200 bg-white p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:bg-zinc-900 dark:shadow-black/20'>
          <div className='flex flex-col gap-1'>
            <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100'>Custom Upload</h2>
            <p className='text-sm text-stone-500 dark:text-stone-400'>
              Drag in an MP4 or WebM and we’ll keep it ready for whenever you want that motion.
            </p>
          </div>

          <div className='mt-4 flex flex-col gap-4 lg:flex-row lg:items-center'>
            <div className='flex-1 space-y-1 py-2'>
              <p className='text-sm text-stone-500 dark:text-stone-400'>Accepted formats: MP4, WebM · Max size 8MB.</p>
              <div className='rounded-xl border border-dashed border-stone-200 bg-stone-50/80 p-4 text-sm text-stone-500 dark:border-stone-700 dark:bg-zinc-800/60 dark:text-stone-200'>
                <p>Uploaded wallpapers appear below. You can switch between them at any time.</p>
              </div>
            </div>

            <div className='flex gap-3'>
              <input
                ref={fileInputRef}
                type='file'
                accept='video/mp4,video/webm'
                className='hidden'
                onChange={handleFileChange}
              />
              <Button variant='primary' onClick={() => fileInputRef.current?.click()} disabled={uploading} className='group'>
                <p className='transition-transform duration-100 group-active:scale-95'>
                  {uploading ? 'Processing…' : 'Browse for video'}
                </p>
              </Button>
            </div>
          </div>
        </section>

        <section className='rounded-2xl border border-neutral-200 bg-white p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:bg-zinc-900 dark:shadow-black/20'>
          <div className='flex flex-col gap-1'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100'>Saved Wallpapers</h2>
                <p className='text-sm text-stone-500 dark:text-stone-400'>Select or delete any saved clip.</p>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button variant='outline2' size='small' onClick={handleResetToDefault} className='group'>
                  <p className='transition-transform duration-100 group-active:scale-95'>Reset to Default</p>
                </Button>
                <Button variant='outline2' size='small' onClick={handleClearGallery} className='group'>
                  <p className='transition-transform duration-100 group-active:scale-95'>Clear Gallery</p>
                </Button>
              </div>
            </div>
          </div>

          <div className='mt-5 grid gap-4 md:grid-cols-2'>
            {videos.length === 0 ? (
              <div className='col-span-full rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/80 p-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:bg-zinc-900/60 dark:text-stone-400'>
                No saved wallpapers yet. Upload a video to get started.
              </div>
            ) : (
              videos.map(video => {
                const isActive = video.id === activeVideoId
                return (
                  <div
                    key={video.id}
                    className={`flex flex-col gap-3 rounded-xl border p-4 transition ${isActive
                        ? 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-500/60 dark:bg-emerald-900/40'
                        : 'border-stone-200 bg-stone-50/70 hover:border-indigo-400 hover:bg-white dark:border-stone-700 dark:bg-zinc-900/70 dark:hover:border-sky-600'
                      }`}
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div>
                        <p className='text-base font-semibold text-stone-900 dark:text-stone-100'>{video.name || 'Uploaded wallpaper'}</p>
                        <p className='text-xs text-stone-500 dark:text-stone-400'>
                          {video.mimeType} · {formatSize(video.size)}
                        </p>
                        <p className='text-xs text-stone-400 dark:text-stone-500'>Added {new Date(video.createdAt).toLocaleString()}</p>
                      </div>
                      {isActive && (
                        <span className='rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:border-emerald-500/60 dark:text-emerald-200'>
                          Active
                        </span>
                      )}
                    </div>
                    <div className='flex flex-wrap gap-2'>
                      <Button
                        variant={isActive ? 'primary' : 'outline2'}
                        size='small'
                        onClick={() => handleSelectVideo(video.id)}
                        className='group'
                      >
                        <p className='transition-transform duration-100 group-active:scale-95'>
                          {isActive ? 'Selected' : 'Use this wallpaper'}
                        </p>
                      </Button>
                      <Button
                        variant='outline2'
                        size='small'
                        onClick={() => handleRemoveVideo(video.id)}
                        className='group'
                      >
                        <p className='transition-transform duration-100 group-active:scale-95'>Remove</p>
                      </Button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default Settings
