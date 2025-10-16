// server/src/routes/search.ts
import express from 'express'
import { MessageService } from '../database/models'
import { asyncHandler } from '../utils/asyncHandler'

const router = express.Router()

// Global search across all messages (no auth/user filter yet)
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const query = (req.query.q as string) || ''
    if (!query.trim()) {
      return res.status(400).json({ error: 'Query parameter q required' })
    }

    const results = MessageService.searchAllUserMessages(query, '1', 50)
    res.json(results)
  })
)

export default router
