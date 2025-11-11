// server/src/routes/search.ts
import express from 'express'
import { asyncHandler } from '../utils/asyncHandler'

const router = express.Router()

// Global search endpoint - Placeholder for future implementation
// Message search has been removed. Search functionality now uses SQLite FTS5 locally.
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = (req.query.q as string) || ''
    if (!query.trim()) {
      return res.status(400).json({ error: 'Query parameter q required' })
    }

    // This endpoint is preserved for future use (e.g., chat title search)
    res.json([])
  })
)

export default router
