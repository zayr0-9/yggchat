import React, { useCallback, useEffect, useState } from 'react'

// Supabase storage base URL for updates
const BASE_URL = 'https://auth.yggchat.com/storage/v1/object/public/updates/updates'

// Manifest file URLs for each platform
const MANIFEST_URLS = {
  windows: `${BASE_URL}/windows/latest.yml`,
  linux: `${BASE_URL}/linux/latest-linux.yml`,
  macos: `${BASE_URL}/mac/latest-mac.yml`,
}

type Platform = 'windows' | 'linux' | 'macos'

interface DownloadInfo {
  url: string | null
  version: string | null
  loading: boolean
  error: string | null
}

interface DownloadAppModalProps {
  isOpen: boolean
  onClose: () => void
}

// Parse latest.yml to extract path and version
function parseManifest(yamlText: string): { path: string | null; version: string | null } {
  const pathMatch = yamlText.match(/^path:\s*(.+)$/m)
  const versionMatch = yamlText.match(/^version:\s*(.+)$/m)
  return {
    path: pathMatch?.[1]?.trim() || null,
    version: versionMatch?.[1]?.trim() || null,
  }
}

export const DownloadAppModal: React.FC<DownloadAppModalProps> = ({ isOpen, onClose }) => {
  const [downloadingPlatform, setDownloadingPlatform] = useState<string | null>(null)
  const [downloadInfo, setDownloadInfo] = useState<Record<Platform, DownloadInfo>>({
    windows: { url: null, version: null, loading: false, error: null },
    linux: { url: null, version: null, loading: false, error: null },
    macos: { url: null, version: null, loading: false, error: null },
  })

  // Only show when VITE_ENVIRONMENT is 'web'
  const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'

  // Fetch manifest files when modal opens
  useEffect(() => {
    if (!isOpen || !isWebMode) return

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

    // Fetch all manifests in parallel
    fetchManifest('windows')
    fetchManifest('linux')
    fetchManifest('macos')
  }, [isOpen, isWebMode])

  const handleDownload = useCallback(
    (platform: Platform) => {
      const info = downloadInfo[platform]
      if (!info.url || info.loading || info.error) return

      setDownloadingPlatform(platform)

      // Open download link in external browser
      if (window.electronAPI?.auth?.openExternal) {
        window.electronAPI.auth.openExternal(info.url)
      } else {
        window.open(info.url, '_blank')
      }

      // Reset downloading state after a short delay
      setTimeout(() => setDownloadingPlatform(null), 1500)
    },
    [downloadInfo]
  )

  // Don't render if not in web mode or if modal is closed
  if (!isWebMode || !isOpen) return null

  const platforms = [
    {
      key: 'windows' as const,
      name: 'Windows',
      icon: 'bxl-windows',
      description: 'Windows 10/11 (64-bit)',
      bgColor: 'bg-blue-500/10',
      hoverBg: 'hover:bg-blue-500/20',
      textColor: 'text-blue-500',
      borderColor: 'border-blue-500/30',
    },
    {
      key: 'linux' as const,
      name: 'Linux',
      icon: 'bxl-tux',
      description: 'Ubuntu, Debian, Fedora',
      bgColor: 'bg-orange-500/10',
      hoverBg: 'hover:bg-orange-500/20',
      textColor: 'text-orange-500',
      borderColor: 'border-orange-500/30',
    },
    {
      key: 'macos' as const,
      name: 'macOS',
      icon: 'bxl-apple',
      description: 'macOS 10.15+',
      bgColor: 'bg-neutral-500/10',
      hoverBg: 'hover:bg-neutral-500/20',
      textColor: 'text-neutral-400',
      borderColor: 'border-neutral-500/30',
    },
  ]

  return (
    <div className='fixed inset-0 acrylic z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200'>
      <div className='bg-white dark:bg-yBlack-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 p-6 max-w-lg w-full mx-4 animate-in slide-in-from-bottom-4 duration-300'>
        <div className='flex flex-col'>
          {/* Header */}
          <div className='flex items-center justify-between mb-6'>
            <div className='flex items-center gap-3'>
              <div className='flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-green-400/20 to-blue-500/20 text-green-500'>
                <i className='bx bx-download text-2xl'></i>
              </div>
              <div>
                <h2 className='text-xl font-semibold text-neutral-900 dark:text-neutral-100'>Download App</h2>
                <p className='text-sm text-neutral-500 dark:text-neutral-400'>Choose your platform</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className='p-2 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors'
            >
              <i className='bx bx-x text-2xl'></i>
            </button>
          </div>

          {/* Platform Buttons */}
          <div className='flex flex-col gap-3'>
            {platforms.map(platform => {
              const info = downloadInfo[platform.key]
              const isDisabled = downloadingPlatform !== null || info.loading || !!info.error || !info.url

              return (
                <button
                  key={platform.key}
                  onClick={() => handleDownload(platform.key)}
                  disabled={isDisabled}
                  className={`
                                        flex items-center gap-4 p-4 rounded-xl border transition-all duration-200
                                        ${platform.bgColor} ${platform.hoverBg} ${platform.borderColor}
                                        disabled:opacity-50 disabled:cursor-not-allowed
                                        group
                                    `}
                >
                  <div className={`flex-shrink-0 p-3 rounded-xl ${platform.bgColor} ${platform.textColor}`}>
                    <i className={`bx ${platform.icon} text-2xl`}></i>
                  </div>
                  <div className='flex-1 text-left'>
                    <div className={`font-semibold ${platform.textColor} flex items-center gap-2`}>
                      {platform.name}
                      {info.version && <span className='text-xs font-normal opacity-70'>v{info.version}</span>}
                    </div>
                    <div className='text-sm text-neutral-500 dark:text-neutral-400'>
                      {info.loading ? (
                        <span className='flex items-center gap-1'>
                          <i className='bx bx-loader-alt bx-spin text-xs'></i>
                          Loading...
                        </span>
                      ) : info.error ? (
                        <span className='text-red-500'>Not available</span>
                      ) : (
                        platform.description
                      )}
                    </div>
                  </div>
                  <div className={`${platform.textColor} opacity-0 group-hover:opacity-100 transition-opacity`}>
                    {downloadingPlatform === platform.key ? (
                      <i className='bx bx-loader-alt bx-spin text-xl'></i>
                    ) : info.loading ? (
                      <i className='bx bx-loader-alt bx-spin text-xl'></i>
                    ) : info.error ? (
                      <i className='bx bx-x-circle text-xl text-red-500'></i>
                    ) : (
                      <i className='bx bx-right-arrow-alt text-xl'></i>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className='mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-700 flex flex-col gap-2'>
            <p className='text-xs text-center text-neutral-400'>
              <i className='bx bx-error-circle mr-1'></i>
              You might see a SmartScreen (Windows) or 'Unidentified Developer' (macOS) warning that you can safely
              ignore
            </p>
            <p className='text-xs text-center text-neutral-500 dark:text-neutral-500'>
              <i className='bx bx-info-circle mr-1'></i>
              Download links will open in your default browser
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DownloadAppModal
