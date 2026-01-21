import React, { useEffect, useRef, useState } from 'react'
import { AsciiBackground } from '../components/landing/AsciiBackground'
import { ChatDemo } from '../components/landing/ChatDemo'
import { Comparison } from '../components/landing/Comparison'
import { Economics } from '../components/landing/Economics'
import { Features } from '../components/landing/Features'
import { Footer } from '../components/landing/Footer'
import { Hero } from '../components/landing/Hero'
import { Navbar } from '../components/landing/Navbar'
import { ScrollReveal } from '../components/landing/ScrollReveal'
type Platform = 'windows' | 'linux' | 'macos'

interface DownloadInfo {
  url: string | null
  version: string | null
  loading: boolean
  error: string | null
}

const BASE_URL = 'https://auth.yggchat.com/storage/v1/object/public/updates/updates'
const MANIFEST_URLS: Record<Platform, string> = {
  windows: `${BASE_URL}/windows/latest.yml`,
  linux: `${BASE_URL}/linux/latest-linux.yml`,
  macos: `${BASE_URL}/mac/latest-mac.yml`,
}

const parseManifest = (yamlText: string): { path: string | null; version: string | null } => {
  const pathMatch = yamlText.match(/^path:\s*(.+)$/m)
  const versionMatch = yamlText.match(/^version:\s*(.+)$/m)
  return {
    path: pathMatch?.[1]?.trim() || null,
    version: versionMatch?.[1]?.trim() || null,
  }
}

const getStoredTheme = () => {
  if (typeof window === 'undefined') return null
  try {
    const storedTheme = window.localStorage.getItem('theme')
    return storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : null
  } catch {
    return null
  }
}

const getSystemPrefersDark = () => {
  if (typeof window === 'undefined') return true
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

const LandingPage: React.FC = () => {
  const [scrollY, setScrollY] = useState(0)
  const [isAsciiActive, setIsAsciiActive] = useState(true)
  const [showDownloadPopup, setShowDownloadPopup] = useState(false)
  const [downloadingPlatform, setDownloadingPlatform] = useState<Platform | null>(null)
  const [downloadInfo, setDownloadInfo] = useState<Record<Platform, DownloadInfo>>({
    windows: { url: null, version: null, loading: false, error: null },
    linux: { url: null, version: null, loading: false, error: null },
    macos: { url: null, version: null, loading: false, error: null },
  })
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const [isDark, setIsDark] = useState(() => {
    const storedTheme = getStoredTheme()
    if (storedTheme) return storedTheme === 'dark'
    return getSystemPrefersDark()
  })
  const [hasExplicitTheme, setHasExplicitTheme] = useState(() => Boolean(getStoredTheme()))

  useEffect(() => {
    const container = scrollContainerRef.current
    const handleScroll = () => {
      if (container) {
        setScrollY(container.scrollTop)
      } else {
        setScrollY(window.scrollY)
      }
    }

    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true })
    } else {
      window.addEventListener('scroll', handleScroll, { passive: true })
    }

    handleScroll()
    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll)
      } else {
        window.removeEventListener('scroll', handleScroll)
      }
    }
  }, [])

  useEffect(() => {
    const heroElement = heroRef.current
    if (!heroElement) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsAsciiActive(entry.isIntersecting)
      },
      { root: scrollContainerRef.current, threshold: 0.15 }
    )

    observer.observe(heroElement)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!showDownloadPopup) return
    if (import.meta.env.VITE_ENVIRONMENT !== 'web') return

    const fetchManifest = async (platform: Platform) => {
      setDownloadInfo(prev => ({
        ...prev,
        [platform]: { ...prev[platform], loading: true, error: null },
      }))

      try {
        const response = await fetch(MANIFEST_URLS[platform])
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const yamlText = await response.text()
        const { path, version } = parseManifest(yamlText)

        if (!path) {
          throw new Error('Could not parse manifest')
        }

        const platformDir = platform === 'macos' ? 'mac' : platform
        const downloadUrl = `${BASE_URL}/${platformDir}/${path}`

        setDownloadInfo(prev => ({
          ...prev,
          [platform]: { url: downloadUrl, version, loading: false, error: null },
        }))
      } catch (err) {
        setDownloadInfo(prev => ({
          ...prev,
          [platform]: {
            url: null,
            version: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load',
          },
        }))
      }
    }

    fetchManifest('windows')
    fetchManifest('linux')
    fetchManifest('macos')
  }, [showDownloadPopup])

  const handleDownload = (platform: Platform) => {
    const info = downloadInfo[platform]
    if (!info.url || info.loading || info.error) return

    setDownloadingPlatform(platform)

    if (window.electronAPI?.auth?.openExternal) {
      window.electronAPI.auth.openExternal(info.url)
    } else {
      window.open(info.url, '_blank')
    }

    setTimeout(() => setDownloadingPlatform(null), 1500)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (hasExplicitTheme) return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      setIsDark(media.matches)
    }

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange)
    } else if (typeof (media as MediaQueryList).addListener === 'function') {
      media.addListener(handleChange)
    }

    return () => {
      if (typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', handleChange)
      } else if (typeof (media as MediaQueryList).removeListener === 'function') {
        media.removeListener(handleChange)
      }
    }
  }, [hasExplicitTheme])

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', isDark)
    if (hasExplicitTheme) {
      window.localStorage.setItem('theme', isDark ? 'dark' : 'light')
    }
  }, [hasExplicitTheme, isDark])

  const toggleTheme = () => {
    setHasExplicitTheme(true)
    setIsDark(current => !current)
  }

  return (
    <div
      ref={scrollContainerRef}
      className='relative h-full min-h-screen overflow-y-auto selection:bg-[#0052FF] selection:text-white transition-colors duration-500 font-inter overflow-x-hidden'
    >
      <AsciiBackground scrollY={scrollY} isDark={isDark} isActive={isAsciiActive} />

      <div className='relative z-10'>
        <Navbar onToggleTheme={toggleTheme} isDark={isDark} />

        <main>
          <div ref={heroRef}>
            <Hero />
          </div>

          <section
            id='features'
            className='py-24 px-6 md:px-12 bg-white dark:bg-black transition-colors duration-500 border-y border-zinc-200 dark:border-zinc-900'
          >
            <div className='max-w-7xl mx-auto'>
              <ScrollReveal className='mb-20'>
                <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[18px]'>
                  [ System Architecture ]
                </span>
                <h2 className='text-5xl md:text-7xl font-black mt-4 leading-tight text-zinc-900 dark:text-white'>
                  UNIFIED
                  <br />
                  INTELLIGENCE.
                </h2>
                <p className='mt-8 text-2xl text-zinc-600 dark:text-zinc-400 max-w-2xl leading-relaxed'>
                  Not just a chat interface or a simple agent—a complete operating layer for AI-native work. Every
                  model, every tool, one workspace.
                </p>
              </ScrollReveal>

              <Features />
            </div>
          </section>

          <section
            id='economics'
            className='py-24 px-6 md:px-12 bg-zinc-50 dark:bg-zinc-950 transition-colors duration-500'
          >
            <div className='max-w-7xl mx-auto'>
              <ScrollReveal className='mb-16'>
                <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[18px]'>
                  [ Unit Economics ]
                </span>
                <h2 className='text-5xl md:text-6xl font-black mt-4 text-zinc-900 dark:text-white uppercase tracking-tighter'>
                  True Scaling.
                </h2>
                <p className='mt-4 text-2xl text-zinc-500 dark:text-zinc-400 font-medium italic'>
                  Yggdrasil is the only agent orchestrator in market that scales efficiently
                </p>
              </ScrollReveal>
              <Economics />
            </div>
          </section>

          <section
            id='comparison'
            className='py-24 px-6 md:px-12 bg-white dark:bg-black transition-colors duration-500 border-y border-zinc-200 dark:border-zinc-900'
          >
            <div className='max-w-7xl mx-auto'>
              <ScrollReveal className='mb-16'>
                <span className='mono text-[#0052FF] font-bold tracking-widest uppercase text-[18px]'>
                  [ Market Realities ]
                </span>
                <h2 className='text-5xl md:text-6xl font-black mt-4 text-zinc-900 dark:text-white uppercase tracking-tighter'>
                  The Agent Divergence.
                </h2>
              </ScrollReveal>
              <Comparison />
            </div>
          </section>

          <section
            id='terminal'
            className='py-24 px-6 md:px-12 bg-zinc-100 dark:bg-zinc-900 overflow-hidden transition-colors duration-500'
          >
            <div className='max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center'>
              <ScrollReveal>
                <h2 className='text-4xl font-bold mb-6 text-zinc-900 dark:text-white'>Observe the Core.</h2>
                <p className='text-zinc-600 text-lg dark:text-zinc-400 mb-8 leading-relaxed'>
                  The branch matrix visualizes how Yggdrasil fans intent across parallel reasoning paths in real time.
                </p>
              </ScrollReveal>

              <ScrollReveal delay='reveal-delayed-2'>
                <ChatDemo isDark={isDark} onDownload={() => setShowDownloadPopup(true)} />
              </ScrollReveal>
            </div>
          </section>
        </main>

        <Footer isDark={isDark} />
      </div>
      {showDownloadPopup && import.meta.env.VITE_ENVIRONMENT === 'web' && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-6'>
          <button
            type='button'
            onClick={() => setShowDownloadPopup(false)}
            className='absolute inset-0 cursor-pointer'
            aria-label='Close download popup'
          />
          <div className='relative z-10 w-full max-w-2xl border-2 border-zinc-200 dark:border-zinc-900 bg-white/95 dark:bg-black/90 backdrop-blur-xl p-8'>
            <div className='flex items-start justify-between gap-6 border-b border-zinc-200 dark:border-zinc-800 pb-6'>
              <div>
                <p className='mono text-[10px] uppercase tracking-[0.3em] text-[#0052FF]'>[ Download Node ]</p>
                <h3 className='text-2xl md:text-3xl font-black uppercase tracking-tight mt-2 text-zinc-900 dark:text-white'>
                  Desktop Builds
                </h3>
                <p className='mt-3 text-sm text-zinc-600 dark:text-zinc-300'>
                  Select your platform and open the latest installer directly.
                </p>
              </div>
              <button
                type='button'
                onClick={() => setShowDownloadPopup(false)}
                className='border-2 border-zinc-900 dark:border-white px-3 py-2 text-xs font-bold uppercase tracking-[0.25em] text-zinc-900 dark:text-white hover:bg-[#0052FF] hover:border-[#0052FF] hover:text-white transition-colors'
              >
                Close
              </button>
            </div>

            <div className='mt-6 grid gap-4 md:grid-cols-3'>
              {(['windows', 'linux', 'macos'] as Platform[]).map(platform => {
                const info = downloadInfo[platform]
                const isDisabled = downloadingPlatform !== null || info.loading || !!info.error || !info.url
                const labels = {
                  windows: 'Windows 10/11 (64-bit)',
                  linux: 'Ubuntu, Debian, Fedora',
                  macos: 'macOS 10.15+',
                }

                return (
                  <button
                    key={platform}
                    type='button'
                    onClick={() => handleDownload(platform)}
                    disabled={isDisabled}
                    className='flex h-full flex-col border-2 border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/70 px-4 py-4 text-left transition-all duration-200 hover:border-[#0052FF] disabled:opacity-50 disabled:cursor-not-allowed'
                  >
                    <div className='flex items-center justify-between gap-2'>
                      <span className='mono text-[10px] uppercase tracking-[0.3em] text-[#0052FF]'>{platform}</span>
                      {info.version && <span className='text-[10px] text-zinc-500'>v{info.version}</span>}
                    </div>
                    <div className='mt-3 text-lg font-semibold text-zinc-900 dark:text-white'>{labels[platform]}</div>
                    <div className='mt-auto pt-3 text-xs text-zinc-500 dark:text-zinc-400'>
                      {info.loading
                        ? 'Loading...'
                        : info.error
                          ? 'Not available'
                          : downloadingPlatform === platform
                            ? 'Opening...'
                            : 'Download installer'}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className='mt-6 border-t border-zinc-200 dark:border-zinc-800 pt-4 text-xs text-zinc-500 dark:text-zinc-400'>
              Download links open in your default browser. You may see SmartScreen or Gatekeeper warnings during install.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LandingPage
