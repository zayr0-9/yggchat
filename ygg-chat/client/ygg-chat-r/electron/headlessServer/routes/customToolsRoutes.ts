import type { Express } from 'express'
import { execute as executeCustomToolManager } from '../../tools/customToolManager.js'

export function registerCustomToolsRoutes(app: Express): void {
  app.get('/api/headless/custom-tools', async (_req, res) => {
    try {
      const result = await executeCustomToolManager({ action: 'list' }, {})
      if (!result?.success) {
        res.status(500).json({ success: false, error: result?.error || 'Failed to list custom tools' })
        return
      }

      res.json({
        success: true,
        tools: Array.isArray(result.tools) ? result.tools : [],
        totalCount: Number(result.totalCount || 0),
      })
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  app.patch('/api/headless/custom-tools/:name', async (req, res) => {
    const name = String(req.params.name || '').trim()
    if (!name) {
      res.status(400).json({ success: false, error: 'Tool name required' })
      return
    }

    const enabled = req.body?.enabled
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ success: false, error: 'enabled boolean required' })
      return
    }

    try {
      const result = await executeCustomToolManager({ action: enabled ? 'enable' : 'disable', name }, {})
      if (!result?.success) {
        const status = /not found/i.test(String(result?.error || '')) ? 404 : 400
        res.status(status).json({ success: false, error: result?.error || 'Failed to update custom tool state' })
        return
      }

      res.json({ success: true, tool: result.tool })
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
