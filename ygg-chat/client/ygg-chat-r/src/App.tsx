import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { LiquidGlassSVG } from './components/LiquidGlassSVG'
import ProtectedRoute from './components/ProtectedRoute'
import VideoBackground from './components/VideoBackground'
import { Chat, ConversationPage, Homepage, LandingPage, Login, PaymentPage, Settings } from './containers'
import IdeContextBootstrap from './IdeContextBootstrap'

function App() {
  return (
    <BrowserRouter>
      {/* Persistent video background across all routes */}
      <VideoBackground />
      {/* SVG filters for liquid glass effect */}
      <LiquidGlassSVG />
      {/* Establish IDE Context WebSocket globally so it's not tied to any specific page */}
      <IdeContextBootstrap />
      <Routes>
        {/* Public route */}
        <Route path='/landingpage' element={<LandingPage />} />
        {/* Public route */}
        <Route path='/login' element={<Login />} />
        {/* Protected routes */}
        <Route
          path='/conversationPage'
          element={
            <ProtectedRoute>
              <ConversationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path='/'
          element={
            <ProtectedRoute>
              <Homepage />
            </ProtectedRoute>
          }
        />
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
    </BrowserRouter>
  )
}

export default App
