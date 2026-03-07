import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const applyThemePreference = () => {
  const root = document.documentElement
  const storedTheme = window.localStorage.getItem('theme')

  if (storedTheme === 'light' || storedTheme === 'dark') {
    root.setAttribute('data-theme', storedTheme)
    return
  }

  root.removeAttribute('data-theme')
}

applyThemePreference()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Missing #root element for mobile app')
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
