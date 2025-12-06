import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { LiquidGlassSVG } from './components/LiquidGlassSVG'
import ProtectedRoute from './components/ProtectedRoute'
import { TitleBar } from './components/TitleBar/TitleBar'
import { UpdateModal } from './components/UpdateModal/UpdateModal'
import VideoBackground from './components/VideoBackground'
import {
  Chat,
  ConversationPage,
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
import IdeContextBootstrap from './IdeContextBootstrap'

// Use HashRouter for Electron (file:// protocol requires hash-based routing)
// Use BrowserRouter for web (standard HTML5 history API)
const isElectron =
  (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__) || import.meta.env.VITE_ENVIRONMENT === 'electron'

const Router = isElectron ? HashRouter : BrowserRouter

function App() {
  return (
    <Router>
      {/* Custom title bar for Windows Electron */}
      <TitleBar />
      {/* Persistent video background across all routes */}
      <VideoBackground />
      {/* SVG filters for liquid glass effect */}
      <LiquidGlassSVG />
      {/* Establish IDE Context WebSocket globally so it's not tied to any specific page */}
      <IdeContextBootstrap />
      {/* Global update modal for Electron auto-updates */}
      <UpdateModal />
      <div className='app-content'>
        <Routes>
          {/* Public route */}
          <Route path='/landingpage' element={<LandingPage />} />
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
      </div>
    </Router>
  )
}

export default App
