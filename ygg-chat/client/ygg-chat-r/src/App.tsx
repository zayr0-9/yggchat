import { Analytics } from '@vercel/analytics/react'
import { AnimatePresence } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import './App.css'
import { HtmlIframeRegistryProvider, useHtmlIframeRegistry } from './components/HtmlIframeRegistry/HtmlIframeRegistry'
import { HtmlToolsModal } from './components/HtmlToolsModal/HtmlToolsModal'
import { LiquidGlassSVG } from './components/LiquidGlassSVG'
import ProtectedRoute from './components/ProtectedRoute'
import { TitleBar } from './components/TitleBar/TitleBar'
import { UpdateModal } from './components/UpdateModal/UpdateModal'
import VideoBackground from './components/VideoBackground'
import {
  BlogPage,
  Chat,
  ConversationPage,
  FAQPage,
  Homepage,
  LandingPage,
  Login,
  PaymentPage,
  PaymentPlans,
  PrivacyPolicy,
  RefundPolicy,
  Settings,
  TermsOfService,
} from './containers'
import RightBar from './containers/rightBar'
import SideBar from './containers/sideBar'
import { selectCurrentConversationId } from './features/chats'
import { selectCurrentUser } from './features/users'
import GlobalAgentBootstrap from './GlobalAgentBootstrap'
import { useAppSelector } from './hooks/redux'
import { useIsMobile } from './hooks/useMediaQuery'
import { useResearchNotes } from './hooks/useQueries'
import IdeContextBootstrap from './IdeContextBootstrap'

// Use HashRouter for Electron (file:// protocol requires hash-based routing)
// Use BrowserRouter for web (standard HTML5 history API)
const isElectron =
  (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__) || import.meta.env.VITE_ENVIRONMENT === 'electron'

const Router = isElectron ? HashRouter : BrowserRouter

const TOOL_VIEWER_HIDDEN_ROUTES = new Set([
  '/',
  '/landingpage',
  '/login',
  '/faq',
  '/paymentplan',
  '/payment',
  '/terms',
  '/refund-policy',
  '/privacy',
  '/blog',
])

const RIGHTBAR_HIDDEN_ROUTES = new Set([
  '/',
  '/landingpage',
  '/login',
  '/faq',
  '/paymentplan',
  '/blog',
  '/terms',
  '/refund-policy',
  '/privacy',
  '/infrastructure',
])

const SIDEBAR_VISIBLE_ROUTE_PATTERNS = [/^\/homepage$/, /^\/conversationPage$/, /^\/chat\/[^/]+\/[^/]+$/]

const getRouteAnimationKey = (pathname: string) => {
  if (/^\/chat\/[^/]+\/[^/]+$/.test(pathname)) {
    return '/chat/:projectId/:id'
  }

  return pathname
}

const HtmlToolsShell = ({ enabled }: { enabled: boolean }) => {
  const location = useLocation()
  const registry = useHtmlIframeRegistry()
  const currentUser = useAppSelector(selectCurrentUser)
  const isMobile = useIsMobile()
  const isHiddenRoute = TOOL_VIEWER_HIDDEN_ROUTES.has(location.pathname)
  const canShow = Boolean(enabled && registry && currentUser && !isHiddenRoute)
  const bootstrappedUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!registry || !enabled || !currentUser || bootstrappedUserIdRef.current === currentUser.id) return
    bootstrappedUserIdRef.current = currentUser.id
    registry.bootstrapFromLocalCache(currentUser.id)
  }, [currentUser, enabled, registry])

  useEffect(() => {
    if (!registry || !enabled || !currentUser) return
    if (!registry.isModalOpen || registry.entries.length > 0) return
    registry.bootstrapFromLocalCache(currentUser.id)
  }, [currentUser, enabled, registry])

  useEffect(() => {
    if (!registry || !registry.isModalOpen) return
    if (!enabled || !currentUser || isHiddenRoute) {
      registry.closeModal()
    }
  }, [currentUser, enabled, isHiddenRoute, registry])

  if (!canShow || !registry) return null

  const isHomepageFullscreen = registry.isHomepageFullscreen

  return (
    <>
      <HtmlToolsModal />
      {!isHomepageFullscreen && (
        <button
          type='button'
          onClick={() => {
            if (registry.isModalOpen) {
              registry.closeModal()
              return
            }
            registry.openModal()
          }}
          className={`fixed ${isMobile ? 'bottom-32 right-5' : 'bottom-6 right-6'} z-[1500] rounded-full border border-neutral-200/80 dark:border-neutral-700/70 bg-white/90 dark:bg-yBlack-900/90 px-4 py-3 text-sm font-semibold text-neutral-800 dark:text-neutral-100 shadow-lg transition hover:scale-[1.02] hover:shadow-xl`}
          aria-label={registry.isModalOpen ? 'Close HTML tools' : 'Open HTML tools'}
        >
          <span className='flex items-center gap-2'>
            {/* <i className='bx bx-window-open text-lg' aria-hidden='true'></i> */}
            {registry.isModalOpen ? 'Close' : 'Apps'}
          </span>
        </button>
      )}
    </>
  )
}

const SideBarShell = () => {
  const location = useLocation()
  const isMobile = useIsMobile()
  const currentUser = useAppSelector(selectCurrentUser)
  const currentConversationId = useAppSelector(selectCurrentConversationId)

  if (!currentUser || isMobile) return null

  const isVisibleRoute = SIDEBAR_VISIBLE_ROUTE_PATTERNS.some(pattern => pattern.test(location.pathname))

  return <SideBar limit={120} activeConversationId={currentConversationId} className={isVisibleRoute ? '' : 'hidden'} />
}

const RightBarShell = () => {
  const location = useLocation()
  const isMobile = useIsMobile()
  const { data: notes = [], isLoading: isLoadingNotes } = useResearchNotes()

  if (isMobile) return null
  if (RIGHTBAR_HIDDEN_ROUTES.has(location.pathname)) return null

  const match = location.pathname.match(/^\/chat\/[^/]+\/([^/]+)$/)
  if (match) return null
  const conversationId = null

  return <RightBar conversationId={conversationId} notes={notes} isLoadingNotes={isLoadingNotes} ccCwd={''} />
}

function AnimatedRoutes() {
  const location = useLocation()

  return (
    <AnimatePresence mode='popLayout'>
      <Routes location={location} key={getRouteAnimationKey(location.pathname)}>
        {/* Public route */}
        <Route path='/landingpage' element={<LandingPage />} />
        {/* Public route */}
        <Route path='/faq' element={<FAQPage />} />
        {/* Public route */}
        <Route path='/login' element={<Login />} />
        {/* Public route */}
        <Route path='/paymentplan' element={<PaymentPlans />} />
        {/* Public route */}
        <Route path='/terms' element={<TermsOfService />} />
        {/* Public route */}
        <Route path='/refund-policy' element={<RefundPolicy />} />
        {/* Public route */}
        <Route path='/privacy' element={<PrivacyPolicy />} />
        {/* Public route */}
        <Route path='/blog' element={<BlogPage />} />
        {/* Protected routes */}
        <Route
          path='/conversationPage'
          element={
            <ProtectedRoute>
              <ConversationPage />
            </ProtectedRoute>
          }
        />
        <Route path='/' element={isElectron ? <Navigate to='/login' replace /> : <LandingPage />} />
        <Route
          path='/homepage'
          element={
            <ProtectedRoute>
              <Homepage />
            </ProtectedRoute>
          }
        />
        <Route
          path='/chat/:projectId/:id'
          element={
            <ProtectedRoute>
              <Chat />
            </ProtectedRoute>
          }
        />
        <Route
          path='/settings'
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path='/payment'
          element={
            <ProtectedRoute>
              <PaymentPage />
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    </AnimatePresence>
  )
}

function App() {
  const currentUser = useAppSelector(selectCurrentUser)
  const resetKey = currentUser?.id ?? null

  const appShell = (
    <>
      {/* Custom title bar for Windows Electron */}
      <TitleBar />
      {/* Persistent video background across all routes */}
      <VideoBackground />
      {/* SVG filters for liquid glass effect */}
      <LiquidGlassSVG />
      {/* Establish IDE Context WebSocket globally so it's not tied to any specific page */}
      <IdeContextBootstrap />
      {/* Initialize global agent loop (Electron only) */}
      <GlobalAgentBootstrap />
      {/* Global update modal for Electron auto-updates */}
      <UpdateModal />
      <div className='app-content'>
        <SideBarShell />
        <div className='app-main'>
          <AnimatedRoutes />
        </div>
        <RightBarShell />
      </div>
      <HtmlToolsShell enabled={isElectron} />
    </>
  )

  return (
    <>
      <Router>
        {isElectron ? (
          <HtmlIframeRegistryProvider resetKey={resetKey}>{appShell}</HtmlIframeRegistryProvider>
        ) : (
          appShell
        )}
      </Router>
      {!isElectron && <Analytics />}
    </>
  )
}

export default App
