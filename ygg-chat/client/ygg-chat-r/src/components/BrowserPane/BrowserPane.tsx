import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'boxicons'
import 'boxicons/css/boxicons.min.css'
import {
  BROWSER_SETTINGS_CHANGE_EVENT,
  BrowserSettings,
  loadBrowserSettings,
} from '../../helpers/browserSettingsStorage'
import { Button } from '../Button/button'
import { getDockTabIndicatorClasses, getDockTabKindLabel, getDockTabToneClasses } from '../dockTabStyles'
import type { MonacoPaneTabItem } from '../MonacoFileEditorPane/MonacoFileEditorPane'

const BROWSER_SESSION_PARTITION = 'persist:ygg-browser'
const LOCAL_HOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(?:\/.*)?$/i
const HOSTNAME_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/.*)?$/i
const PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/

type BrowserWebviewElement = HTMLElement & {
  src: string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  getURL: () => string
  getTitle: () => string
  getWebContentsId: () => number
}

type BrowserWebviewNavigationEvent = Event & {
  url?: string
}

type BrowserWebviewTitleEvent = Event & {
  title?: string
}

type BrowserWebviewFailLoadEvent = Event & {
  errorCode?: number
  errorDescription?: string
  validatedURL?: string
}

export interface BrowserPaneTabState {
  id: string
  title: string
  requestedUrl: string
  currentUrl: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  lastError: string | null
}

interface BrowserPaneProps {
  browserTabs: BrowserPaneTabState[]
  activeBrowserTabId: string | null
  theme: 'vs' | 'vs-dark'
  tabs: MonacoPaneTabItem[]
  activeTabId: string | null
  onUpdateTab: (tabId: string, updates: Partial<BrowserPaneTabState>) => void
  onOpenNewTab: () => void
  onClose: () => void
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  tabToolbar?: React.ReactNode
}

const getHostnameFromUrl = (value: string): string | null => {
  if (!value) return null

  try {
    const hostname = new URL(value).hostname.replace(/^www\./i, '').trim()
    return hostname || null
  } catch {
    return null
  }
}

const deriveBrowserTitle = (title: string | null | undefined, url: string): string => {
  const trimmedTitle = (title || '').trim()
  if (trimmedTitle) return trimmedTitle
  return getHostnameFromUrl(url) || 'Browser'
}

const normalizeBrowserUrl = (input: string): { success: true; url: string } | { success: false; error: string } => {
  const trimmed = input.trim()
  if (!trimmed) {
    return { success: false, error: 'Enter a URL to browse.' }
  }

  if (PROTOCOL_PATTERN.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { success: false, error: 'Only http:// and https:// URLs are supported.' }
      }
      return { success: true, url: url.toString() }
    } catch {
      return { success: false, error: 'Enter a valid URL.' }
    }
  }

  const normalized = trimmed.replace(/^\/\//, '')

  if (LOCAL_HOST_PATTERN.test(normalized)) {
    return { success: true, url: `http://${normalized}` }
  }

  if (HOSTNAME_PATTERN.test(normalized)) {
    return { success: true, url: `https://${normalized}` }
  }

  return { success: false, error: 'Enter a valid hostname or full URL.' }
}

const safeGetCurrentUrl = (webview: BrowserWebviewElement | null): string => {
  try {
    return webview?.getURL()?.trim() || ''
  } catch {
    return ''
  }
}

const safeGetCurrentTitle = (webview: BrowserWebviewElement | null): string => {
  try {
    return webview?.getTitle()?.trim() || ''
  } catch {
    return ''
  }
}

const safeCanGoBack = (webview: BrowserWebviewElement | null): boolean => {
  try {
    return Boolean(webview?.canGoBack())
  } catch {
    return false
  }
}

const safeCanGoForward = (webview: BrowserWebviewElement | null): boolean => {
  try {
    return Boolean(webview?.canGoForward())
  } catch {
    return false
  }
}

export const BrowserPane: React.FC<BrowserPaneProps> = ({
  browserTabs,
  activeBrowserTabId,
  theme,
  tabs,
  activeTabId,
  onUpdateTab,
  onOpenNewTab,
  onClose,
  onSelectTab,
  onCloseTab,
  tabToolbar,
}) => {
  const webviewRefs = useRef<Record<string, BrowserWebviewElement | null>>({})
  const cleanupRefs = useRef<Record<string, () => void>>({})
  const refCallbacks = useRef<Record<string, (node: HTMLElement | null) => void>>({})
  const browserTabsRef = useRef(browserTabs)
  const updateTabRef = useRef(onUpdateTab)
  const [addressValue, setAddressValue] = useState('')
  const [guestDevToolsEnabled, setGuestDevToolsEnabled] = useState(() => loadBrowserSettings().guestDevToolsEnabled)
  const isElectronRuntime = Boolean(window.electronAPI)
  const activeBrowser = useMemo(
    () => browserTabs.find(tab => tab.id === activeBrowserTabId) ?? browserTabs[0] ?? null,
    [activeBrowserTabId, browserTabs]
  )
  const statusLabel = activeBrowser?.isLoading ? 'Loading…' : 'Ready'

  useEffect(() => {
    browserTabsRef.current = browserTabs
  }, [browserTabs])

  useEffect(() => {
    updateTabRef.current = onUpdateTab
  }, [onUpdateTab])

  useEffect(() => {
    setAddressValue(activeBrowser?.currentUrl || activeBrowser?.requestedUrl || '')
  }, [activeBrowser?.currentUrl, activeBrowser?.id, activeBrowser?.requestedUrl])

  useEffect(() => {
    const handleBrowserSettingsChange = (event: Event) => {
      const browserSettingsEvent = event as CustomEvent<BrowserSettings>
      setGuestDevToolsEnabled(Boolean(browserSettingsEvent.detail?.guestDevToolsEnabled))
    }

    window.addEventListener(BROWSER_SETTINGS_CHANGE_EVENT, handleBrowserSettingsChange as EventListener)
    return () => {
      window.removeEventListener(BROWSER_SETTINGS_CHANGE_EVENT, handleBrowserSettingsChange as EventListener)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadGuestDevToolsAvailability = async () => {
      if (!window.electronAPI?.browser?.isGuestDevToolsEnabled) return

      try {
        const enabled = await window.electronAPI.browser.isGuestDevToolsEnabled()
        if (!cancelled) {
          setGuestDevToolsEnabled(Boolean(enabled))
        }
      } catch {
        if (!cancelled) {
          setGuestDevToolsEnabled(loadBrowserSettings().guestDevToolsEnabled)
        }
      }
    }

    void loadGuestDevToolsAvailability()

    return () => {
      cancelled = true
    }
  }, [])

  const syncTabState = useCallback(
    (tabId: string, webview: BrowserWebviewElement | null, updates: Partial<BrowserPaneTabState> = {}) => {
      const currentTab = browserTabsRef.current.find(tab => tab.id === tabId) ?? null
      const hasRequestedUrl = Object.prototype.hasOwnProperty.call(updates, 'requestedUrl')
      const hasCurrentUrl = Object.prototype.hasOwnProperty.call(updates, 'currentUrl')
      const hasTitle = Object.prototype.hasOwnProperty.call(updates, 'title')

      const nextRequestedUrl = hasRequestedUrl
        ? (updates.requestedUrl ?? '')
        : currentTab?.requestedUrl || safeGetCurrentUrl(webview) || currentTab?.currentUrl || ''

      const nextCurrentUrl = hasCurrentUrl
        ? (updates.currentUrl ?? '')
        : safeGetCurrentUrl(webview) || currentTab?.currentUrl || nextRequestedUrl

      const nextTitle = deriveBrowserTitle(
        hasTitle ? (updates.title ?? '') : safeGetCurrentTitle(webview) || currentTab?.title || '',
        nextCurrentUrl || nextRequestedUrl
      )

      const nextLastError = Object.prototype.hasOwnProperty.call(updates, 'lastError')
        ? (updates.lastError ?? null)
        : (currentTab?.lastError ?? null)

      updateTabRef.current(tabId, {
        title: nextTitle,
        requestedUrl: nextRequestedUrl,
        currentUrl: nextCurrentUrl,
        isLoading: typeof updates.isLoading === 'boolean' ? updates.isLoading : (currentTab?.isLoading ?? false),
        canGoBack: safeCanGoBack(webview),
        canGoForward: safeCanGoForward(webview),
        lastError: nextLastError,
      })
    },
    []
  )

  const bindWebview = useCallback(
    (tabId: string, node: BrowserWebviewElement | null) => {
      const currentNode = webviewRefs.current[tabId] ?? null
      if (currentNode === node) return

      cleanupRefs.current[tabId]?.()
      delete cleanupRefs.current[tabId]
      webviewRefs.current[tabId] = node

      if (!node) return

      const handleDidStartLoading = () => {
        syncTabState(tabId, node, { isLoading: true, lastError: null })
      }

      const handleDidStopLoading = () => {
        syncTabState(tabId, node, { isLoading: false, lastError: null })
      }

      const handleDidNavigate = (event: Event) => {
        const navigationEvent = event as BrowserWebviewNavigationEvent
        const nextUrl = navigationEvent.url || safeGetCurrentUrl(node)
        syncTabState(tabId, node, {
          requestedUrl: nextUrl,
          currentUrl: nextUrl,
          isLoading: false,
          lastError: null,
        })
      }

      const handleDidNavigateInPage = (event: Event) => {
        const navigationEvent = event as BrowserWebviewNavigationEvent
        const nextUrl = navigationEvent.url || safeGetCurrentUrl(node)
        syncTabState(tabId, node, {
          requestedUrl: nextUrl,
          currentUrl: nextUrl,
          isLoading: false,
          lastError: null,
        })
      }

      const handleDidFailLoad = (event: Event) => {
        const failEvent = event as BrowserWebviewFailLoadEvent
        if (failEvent.errorCode === -3) return

        const currentTab = browserTabsRef.current.find(tab => tab.id === tabId) ?? null
        const failedUrl =
          failEvent.validatedURL || safeGetCurrentUrl(node) || currentTab?.requestedUrl || currentTab?.currentUrl || ''
        syncTabState(tabId, node, {
          requestedUrl: failedUrl,
          currentUrl: failedUrl,
          isLoading: false,
          lastError: failEvent.errorDescription || 'Failed to load page.',
        })
      }

      const handlePageTitleUpdated = (event: Event) => {
        const titleEvent = event as BrowserWebviewTitleEvent
        syncTabState(tabId, node, {
          title: titleEvent.title || safeGetCurrentTitle(node),
        })
      }

      const handleDomReady = () => {
        syncTabState(tabId, node)
      }

      node.addEventListener('did-start-loading', handleDidStartLoading)
      node.addEventListener('did-stop-loading', handleDidStopLoading)
      node.addEventListener('did-navigate', handleDidNavigate)
      node.addEventListener('did-navigate-in-page', handleDidNavigateInPage)
      node.addEventListener('did-fail-load', handleDidFailLoad)
      node.addEventListener('page-title-updated', handlePageTitleUpdated)
      node.addEventListener('dom-ready', handleDomReady)

      cleanupRefs.current[tabId] = () => {
        node.removeEventListener('did-start-loading', handleDidStartLoading)
        node.removeEventListener('did-stop-loading', handleDidStopLoading)
        node.removeEventListener('did-navigate', handleDidNavigate)
        node.removeEventListener('did-navigate-in-page', handleDidNavigateInPage)
        node.removeEventListener('did-fail-load', handleDidFailLoad)
        node.removeEventListener('page-title-updated', handlePageTitleUpdated)
        node.removeEventListener('dom-ready', handleDomReady)
      }
    },
    [syncTabState]
  )

  const getWebviewRef = useCallback(
    (tabId: string) => {
      if (!refCallbacks.current[tabId]) {
        refCallbacks.current[tabId] = (node: HTMLElement | null) => {
          bindWebview(tabId, node as BrowserWebviewElement | null)
        }
      }

      return refCallbacks.current[tabId]
    },
    [bindWebview]
  )

  useEffect(() => {
    const activeIds = new Set(browserTabs.map(tab => tab.id))

    Object.keys(webviewRefs.current).forEach(tabId => {
      if (activeIds.has(tabId)) return
      cleanupRefs.current[tabId]?.()
      delete cleanupRefs.current[tabId]
      delete webviewRefs.current[tabId]
      delete refCallbacks.current[tabId]
    })
  }, [browserTabs])

  useEffect(() => {
    return () => {
      Object.values(cleanupRefs.current).forEach(cleanup => cleanup())
      cleanupRefs.current = {}
      webviewRefs.current = {}
      refCallbacks.current = {}
    }
  }, [])

  const handleSubmitAddress = useCallback(
    (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      if (!activeBrowser) return

      const normalized = normalizeBrowserUrl(addressValue)
      if ('error' in normalized) {
        onUpdateTab(activeBrowser.id, { lastError: normalized.error })
        return
      }

      onUpdateTab(activeBrowser.id, {
        title: deriveBrowserTitle(activeBrowser.title, normalized.url),
        requestedUrl: normalized.url,
        isLoading: true,
        lastError: null,
      })
      setAddressValue(normalized.url)
    },
    [activeBrowser, addressValue, onUpdateTab]
  )

  const handleBack = useCallback(() => {
    if (!activeBrowser) return
    const webview = webviewRefs.current[activeBrowser.id] ?? null
    if (!webview || !safeCanGoBack(webview)) return

    try {
      webview.goBack()
    } catch {
      // Ignore guest navigation failures.
    }
  }, [activeBrowser])

  const handleForward = useCallback(() => {
    if (!activeBrowser) return
    const webview = webviewRefs.current[activeBrowser.id] ?? null
    if (!webview || !safeCanGoForward(webview)) return

    try {
      webview.goForward()
    } catch {
      // Ignore guest navigation failures.
    }
  }, [activeBrowser])

  const handleReload = useCallback(() => {
    if (!activeBrowser) return
    const webview = webviewRefs.current[activeBrowser.id] ?? null
    if (!webview) return

    onUpdateTab(activeBrowser.id, { isLoading: true, lastError: null })

    try {
      webview.reload()
    } catch {
      onUpdateTab(activeBrowser.id, { isLoading: false, lastError: 'Failed to reload page.' })
    }
  }, [activeBrowser, onUpdateTab])

  const handleOpenDevTools = useCallback(async () => {
    if (!activeBrowser || !window.electronAPI?.browser?.openGuestDevTools) return

    const webview = webviewRefs.current[activeBrowser.id] ?? null
    if (!webview || typeof webview.getWebContentsId !== 'function') {
      onUpdateTab(activeBrowser.id, {
        lastError: 'Browser DevTools are unavailable until the page finishes attaching.',
      })
      return
    }

    try {
      const webContentsId = webview.getWebContentsId()
      const result = await window.electronAPI.browser.openGuestDevTools(webContentsId)
      if (!result?.success) {
        onUpdateTab(activeBrowser.id, { lastError: result?.error || 'Failed to open browser DevTools.' })
      }
    } catch (error) {
      onUpdateTab(activeBrowser.id, {
        lastError: error instanceof Error ? error.message : 'Failed to open browser DevTools.',
      })
    }
  }, [activeBrowser, onUpdateTab])

  return (
    <section className='relative flex h-full min-h-0 flex-col overflow-hidden rounded-b-2xl bg-white/70 shadow-lg backdrop-blur-sm dark:bg-neutral-950/60'>
      <div className='flex items-center gap-2 border-b border-neutral-200 px-2 py-2 dark:border-neutral-800'>
        <div className='flex min-w-0 flex-1 items-center gap-1 overflow-x-auto'>
          {tabs.map(tab => {
            const isActive = tab.id === activeTabId
            const kindLabel = getDockTabKindLabel(tab.kind)

            return (
              <div
                key={tab.id}
                role='tab'
                aria-selected={isActive}
                tabIndex={0}
                onClick={() => onSelectTab(tab.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectTab(tab.id)
                  }
                }}
                className={`group flex min-w-0 max-w-[240px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition-colors ${getDockTabToneClasses(tab.kind, isActive)}`}
                title={tab.title || tab.label}
              >
                <div className='flex min-w-0 flex-1 items-center gap-2 text-left'>
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${getDockTabIndicatorClasses(tab.kind, tab.isDirty)}`}
                  />
                  <span className='truncate'>{tab.label}</span>
                  {kindLabel ? <span className='text-[10px] opacity-70'>{kindLabel}</span> : null}
                  {tab.isSaving ? <span className='text-[10px] opacity-70'>Saving…</span> : null}
                </div>
                <button
                  type='button'
                  onClick={event => {
                    event.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                  className='rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-100'
                  aria-label={`Close ${tab.label}`}
                  title='Close tab'
                >
                  <i className='bx bx-x text-sm' />
                </button>
              </div>
            )
          })}
        </div>
        {tabToolbar ? <div className='flex shrink-0 items-center gap-2 pl-2'>{tabToolbar}</div> : null}
      </div>

      <header className='flex flex-col gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800'>
        <div className='flex items-center justify-between gap-3'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <strong className='truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100'>
                {activeBrowser
                  ? deriveBrowserTitle(activeBrowser.title, activeBrowser.currentUrl || activeBrowser.requestedUrl)
                  : 'Browser'}
              </strong>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  activeBrowser?.isLoading
                    ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
                }`}
              >
                {statusLabel}
              </span>
            </div>
            <div
              className='mt-0.5 truncate text-[11px] text-neutral-500 dark:text-neutral-400'
              title={activeBrowser?.currentUrl || activeBrowser?.requestedUrl || ''}
            >
              {activeBrowser?.currentUrl || activeBrowser?.requestedUrl || 'No page loaded'}
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            {guestDevToolsEnabled ? (
              <Button
                variant='outline2'
                size='circle'
                rounded='full'
                className='h-8 w-8 p-0'
                onClick={() => void handleOpenDevTools()}
                aria-label='Open DevTools'
                title='Open DevTools'
              >
                <i className='bx bx-code-alt text-lg' aria-hidden='true' />
              </Button>
            ) : null}
            <Button
              variant='outline2'
              size='circle'
              rounded='full'
              className='h-8 w-8 p-0'
              onClick={onOpenNewTab}
              aria-label='Open new tab'
              title='Open new tab'
            >
              <i className='bx bx-plus text-lg' aria-hidden='true' />
            </Button>
            <Button
              variant='outline2'
              size='circle'
              rounded='full'
              className='h-8 w-8 p-0'
              onClick={onClose}
              aria-label='Close browser tab'
              title='Close browser tab'
            >
              <i className='bx bx-x text-lg' aria-hidden='true' />
            </Button>
          </div>
        </div>

        <form className='flex flex-wrap items-center gap-2' onSubmit={handleSubmitAddress}>
          <Button
            variant='outline2'
            size='circle'
            rounded='full'
            className='h-8 w-8 p-0'
            onClick={handleBack}
            disabled={!activeBrowser?.canGoBack}
            type='button'
            aria-label='Back'
            title='Back'
          >
            <i className='bx bx-left-arrow-alt text-lg' aria-hidden='true' />
          </Button>
          <Button
            variant='outline2'
            size='circle'
            rounded='full'
            className='h-8 w-8 p-0'
            onClick={handleForward}
            disabled={!activeBrowser?.canGoForward}
            type='button'
            aria-label='Forward'
            title='Forward'
          >
            <i className='bx bx-right-arrow-alt text-lg' aria-hidden='true' />
          </Button>
          <Button
            variant='outline2'
            size='circle'
            rounded='full'
            className='h-8 w-8 p-0'
            onClick={handleReload}
            disabled={!activeBrowser}
            type='button'
            aria-label='Reload page'
            title='Reload page'
          >
            <i className='bx bx-refresh text-lg' aria-hidden='true' />
          </Button>
          <div className='min-w-[220px] flex-1'>
            <input
              type='text'
              value={addressValue}
              onChange={event => setAddressValue(event.target.value)}
              placeholder='Enter a URL'
              className='w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm outline-none transition-colors focus:border-amber-300 focus:ring-2 focus:ring-amber-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:border-amber-500/60 dark:focus:ring-amber-500/20'
              spellCheck={false}
              autoCapitalize='off'
              autoCorrect='off'
            />
          </div>
          <Button
            variant='outline2'
            size='circle'
            rounded='full'
            className='h-8 w-8 p-0'
            type='submit'
            disabled={!activeBrowser}
            aria-label='Go'
            title='Go'
          >
            <i className='bx bx-right-arrow-alt text-lg' aria-hidden='true' />
          </Button>
        </form>
      </header>

      {activeBrowser?.lastError ? (
        <div className='border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200'>
          {activeBrowser.lastError}
        </div>
      ) : null}

      <div className={`relative min-h-0 flex-1 ${theme === 'vs-dark' ? 'bg-[#0a0a0a]' : 'bg-[#f8fafc]'}`}>
        {!isElectronRuntime ? (
          <div className='absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-neutral-500 dark:text-neutral-300'>
            Browser pane is only available inside the Electron desktop app.
          </div>
        ) : (
          browserTabs.map(tab => {
            const isVisible = tab.id === activeBrowserTabId
            return (
              <div key={tab.id} className={isVisible ? 'h-full w-full' : 'hidden'}>
                <webview
                  ref={getWebviewRef(tab.id)}
                  src={tab.requestedUrl}
                  partition={BROWSER_SESSION_PARTITION}
                  className='h-full w-full'
                />
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

export default BrowserPane
