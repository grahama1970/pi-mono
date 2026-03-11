import { Router } from 'express'
import { z } from 'zod'
import { readFile } from 'fs/promises'
import { writeFile } from 'fs/promises'

const ScreenshotSchema = z.object({
  dataUrl: z.string().startsWith('data:image/'),
})

const LoadBriefSchema = z.object({
  path: z.string().min(1),
})

// In-memory screenshot store
let latestScreenshot: { dataUrl: string; timestamp: number } | null = null

/** Exported for testing — resets in-memory screenshot store */
export function resetScreenshotStore(): void {
  latestScreenshot = null
}

export function createCompositionRouter(): Router {
  const router = Router()

  // POST /api/v1/screenshot — store a screenshot from the browser
  router.post('/screenshot', (req, res) => {
    const result = ScreenshotSchema.safeParse(req.body)
    if (!result.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    latestScreenshot = {
      dataUrl: result.data.dataUrl,
      timestamp: Date.now(),
    }

    // Estimate size from base64 data
    const base64Part = result.data.dataUrl.split(',')[1] || ''
    const size = Math.ceil((base64Part.length * 3) / 4)

    res.json({ stored: true, size })
  })

  // GET /api/v1/screenshot — retrieve the last stored screenshot
  router.get('/screenshot', (_req, res) => {
    if (!latestScreenshot) {
      res.status(404).json({ error: 'No screenshot stored' })
      return
    }
    res.json(latestScreenshot)
  })

  // POST /api/v1/review — trigger a design review
  router.post('/review', async (_req, res) => {
    if (!latestScreenshot) {
      res.status(404).json({ error: 'No screenshot stored — capture one first' })
      return
    }

    const timestamp = Date.now()
    const screenshotPath = `/tmp/ux-lab-review-${timestamp}.png`

    try {
      // Extract base64 data and write to file
      const base64Data = latestScreenshot.dataUrl.split(',')[1] || ''
      await writeFile(screenshotPath, Buffer.from(base64Data, 'base64'))

      res.json({
        screenshot_path: screenshotPath,
        review_command: `bash .pi/skills/review-design/run.sh --image ${screenshotPath}`,
      })
    } catch (err) {
      res.status(500).json({ error: 'Failed to write screenshot file' })
    }
  })

  // POST /api/v1/test — trigger test-interactions
  router.post('/test', async (_req, res) => {
    if (!latestScreenshot) {
      res.status(404).json({ error: 'No screenshot stored — capture one first' })
      return
    }

    const timestamp = Date.now()
    const screenshotPath = `/tmp/ux-lab-test-${timestamp}.png`

    try {
      const base64Data = latestScreenshot.dataUrl.split(',')[1] || ''
      await writeFile(screenshotPath, Buffer.from(base64Data, 'base64'))

      res.json({
        screenshot_path: screenshotPath,
        test_command: `bash .pi/skills/test-interactions/run.sh --image ${screenshotPath}`,
      })
    } catch (err) {
      res.status(500).json({ error: 'Failed to write screenshot file' })
    }
  })

  // POST /api/v1/load-brief — load a DESIGN_BOARD.md file
  router.post('/load-brief', async (req, res) => {
    const result = LoadBriefSchema.safeParse(req.body)
    if (!result.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    try {
      const content = await readFile(result.data.path, 'utf-8')
      // Extract markdown sections (lines starting with #)
      const sections = content
        .split('\n')
        .filter((line) => /^#{1,6}\s/.test(line))
        .map((line) => line.replace(/^#+\s*/, '').trim())

      res.json({ content, sections })
    } catch {
      res.status(404).json({ error: 'File not found', path: result.data.path })
    }
  })

  return router
}
