import { useIdeContext } from './hooks/useIdeContext'

// Headless initializer to establish the IDE Context WebSocket once per app.
// Mounted at the app root so IDE features work across all routes (Homepage, Chat, etc.)
export default function IdeContextBootstrap() {
  // Calling the hook triggers its connection and auto-sync side effects.
  useIdeContext()
  return null
}
