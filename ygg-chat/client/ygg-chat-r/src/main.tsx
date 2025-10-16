// import { StrictMode } from 'react'
// import { createRoot } from 'react-dom/client'
// import './index.css'
// import App from './App.tsx'

// createRoot(document.getElementById('root')!).render(
//   <StrictMode>
//     <App />
//   </StrictMode>
// )

// main.tsx
// import React from 'react'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import './index.css'
import { store } from './store/store'
import { updateThunkExtraQueryClient } from './store/thunkExtra'

// Configure React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000, // Data stays fresh for 5 seconds
      gcTime: 10 * 60 * 1000, // Cache persists for 10 minutes (renamed from cacheTime in v5)
      refetchOnWindowFocus: false, // Don't refetch on window focus
      refetchOnMount: false, // Don't refetch on component mount
      refetchOnReconnect: false, // Don't refetch on network reconnect
      refetchInterval: false, // Disable automatic polling
      refetchIntervalInBackground: false, // Disable background polling
      retry: 1, // Retry failed requests once
      networkMode: 'always', // Force request deduplication even when offline
    },
  },
})

// Make queryClient available to Redux thunks for cache synchronization
updateThunkExtraQueryClient(queryClient)

// Set explicit defaults for conversation and project queries to prevent background refetching
// This ensures cached queries from unmounted components (Homepage/ConversationPage)
// don't refetch when user is on Chat page
queryClient.setQueryDefaults(['conversations'], {
  refetchOnWindowFocus: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchInterval: false,
})

queryClient.setQueryDefaults(['projects'], {
  refetchOnWindowFocus: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
  refetchInterval: false,
})

// React Query cache persistence configuration
// Persists conversations and projects to localStorage to survive page refresh
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'ygg-react-query-cache',
})

// Global theme manager: keeps the `dark` class in sync with user preference and system theme
// Runs once per page load (guarded for HMR) so it applies across all routes
;(function initThemeManager() {
  if (typeof window === 'undefined') return
  const w = window as any
  if (w.__yggThemeInit) return
  w.__yggThemeInit = true

  const media = window.matchMedia('(prefers-color-scheme: dark)')

  const apply = () => {
    try {
      const pref = localStorage.getItem('theme') // 'light' | 'dark' | null (null => system)
      const isDark = pref === 'dark' || (pref !== 'light' && media.matches)
      document.documentElement.classList.toggle('dark', isDark)
    } catch {
      // If localStorage is blocked, fall back to system
      document.documentElement.classList.toggle('dark', media.matches)
    }
  }

  // Initial apply
  apply()

  // Update on system theme changes only when following system (no explicit preference)
  const onMediaChange = () => {
    try {
      if (!localStorage.getItem('theme')) apply()
    } catch {
      apply()
    }
  }
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onMediaChange)
  } else if (typeof (media as any).addListener === 'function') {
    ;(media as any).addListener(onMediaChange)
  }

  // React to preference changes from other tabs/windows
  window.addEventListener('storage', e => {
    if (e.key === 'theme') apply()
  })
})()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const root = ReactDOM.createRoot(rootElement)

root.render(
  // StrictMode temporarily disabled to prevent double-mounting in development
  // which causes duplicate API requests and triggers rate limiting
  // TODO: Re-enable once request deduplication is fully stable
  // <React.StrictMode>
  <PersistQueryClientProvider
    client={queryClient}
    persistOptions={{
      persister,
      maxAge: 24 * 60 * 60 * 1000, // Persist cache for 24 hours max
      dehydrateOptions: {
        // Only persist conversations and projects queries to avoid bloating localStorage
        shouldDehydrateQuery: query => {
          const queryKey = query.queryKey[0]
          return queryKey === 'conversations' || queryKey === 'projects'
        },
      },
    }}
  >
    <Provider store={store}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Provider>
    <ReactQueryDevtools initialIsOpen={false} />
  </PersistQueryClientProvider>
  // </React.StrictMode>
)
