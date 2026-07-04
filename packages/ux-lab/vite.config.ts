import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'fs'
import type { Plugin } from 'vite'
import { transportReviewBundlePlugin } from './plugins/transportReviewBundlePlugin'

const uxLabApiPort = Number(process.env.UX_LAB_API_PORT ?? process.env.PORT ?? 3001)
const uxLabApiTarget = `http://localhost:${uxLabApiPort}`
const uxLabWsTarget = `ws://localhost:${uxLabApiPort}`

function chatterboxArtifactsPlugin(): Plugin {
  const ROOT = '/tmp/chatterbox-fork-agent-out'
  return {
    name: 'chatterbox-artifacts',
    configureServer(server) {
      server.middlewares.use('/chatterbox-artifacts', (req, res) => {
        try {
          const rawUrl = req.url ?? '/'
          const pathname = decodeURIComponent(rawUrl.split('?')[0] ?? '/')
          const relative = pathname.replace(/^\/+/, '')
          const absolutePath = resolve(ROOT, relative)
          if (!absolutePath.startsWith(`${ROOT}/`)) {
            res.statusCode = 403
            res.end('forbidden')
            return
          }
          const stat = statSync(absolutePath)
          if (!stat.isFile()) {
            res.statusCode = 404
            res.end('not found')
            return
          }
          if (absolutePath.endsWith('.wav')) res.setHeader('Content-Type', 'audio/wav')
          else if (absolutePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json')
          else res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', String(stat.size))
          createReadStream(absolutePath).pipe(res)
        } catch {
          res.statusCode = 404
          res.end('not found')
        }
      })
    },
  }
}

/** PDF Lab sign-off persistence middleware.
 *
 * Bridges the labeling UI's per-page sign-off snapshots to a disk path
 * that the project agent can read directly. Closes the human↔agent
 * collaboration loop: every time the human signs off a page, the snapshot
 * is written to /tmp/.../signoffs/current.json. The agent reads that
 * file at any time without needing the human to export/save manually.
 *
 * Endpoints (non-/api so they don't collide with the existing proxy):
 *   POST /pdf-lab-api/signoffs/save  — body: full signoff bundle JSON
 *   GET  /pdf-lab-api/signoffs/load  — returns the on-disk bundle (or {})
 */
function pdfLabSignoffsPlugin(): Plugin {
  const BASE_DIR =
    '/tmp/nist-corpus-graph-design-review/.plan-iterate/phase-04-7-hyperlink-chip-canary/evidence-artifacts/signoffs'
  const SIGNOFFS_PATH = `${BASE_DIR}/current.json`
  const IN_PROGRESS_PATH = `${BASE_DIR}/in_progress.json`
  return {
    name: 'pdf-lab-signoffs',
    configureServer(server) {
      server.middlewares.use('/pdf-lab-api/signoffs', (req, res) => {
        const readBody = (cb: (body: string) => void) => {
          let body = ''
          req.on('data', chunk => { body += chunk.toString() })
          req.on('end', () => cb(body))
        }
        // POST /save-in-progress — continuous auto-save of current edit state.
        // Body: { project_id, page_slug, regions, regions_initial, updated_at }
        // Disk: in_progress.json is keyed by `${project_id}::${page_slug}`
        // so the agent can see WIP edits across pages.
        // (Checked BEFORE /save so the more-specific path matches first.)
        if (req.method === 'POST' && req.url?.startsWith('/save-in-progress')) {
          readBody(body => {
            try {
              const entry = JSON.parse(body) as {
                project_id: string; page_slug: string;
                regions: unknown[]; regions_initial: unknown[];
                updated_at: string;
              }
              mkdirSync(BASE_DIR, { recursive: true })
              const existing = existsSync(IN_PROGRESS_PATH)
                ? JSON.parse(readFileSync(IN_PROGRESS_PATH, 'utf-8'))
                : { schema_version: 'pdf_lab.in_progress.v1', entries: {} as Record<string, unknown> }
              const key = `${entry.project_id}::${entry.page_slug}`
              existing.entries[key] = entry
              existing.updated_at = entry.updated_at
              writeFileSync(IN_PROGRESS_PATH, JSON.stringify(existing, null, 2))
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, key, bytes: body.length }))
            } catch (err) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: String(err) }))
            }
          })
          return
        }
        // POST /save — signed-off snapshot bundle (authoritative verdicts)
        if (req.method === 'POST' && req.url?.startsWith('/save')) {
          readBody(body => {
            try {
              const parsed = JSON.parse(body)
              mkdirSync(BASE_DIR, { recursive: true })
              writeFileSync(SIGNOFFS_PATH, JSON.stringify(parsed, null, 2))
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true, path: SIGNOFFS_PATH, bytes: body.length }))
            } catch (err) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: String(err) }))
            }
          })
          return
        }
        // GET /load-in-progress checked BEFORE /load (same shadowing fix).
        if (req.method === 'GET' && req.url?.startsWith('/load-in-progress')) {
          res.setHeader('Content-Type', 'application/json')
          if (existsSync(IN_PROGRESS_PATH)) {
            res.statusCode = 200
            res.end(readFileSync(IN_PROGRESS_PATH, 'utf-8'))
          } else {
            res.statusCode = 200
            res.end(JSON.stringify({ schema_version: 'pdf_lab.in_progress.v1', entries: {} }))
          }
          return
        }
        if (req.method === 'GET' && req.url?.startsWith('/load')) {
          res.setHeader('Content-Type', 'application/json')
          if (existsSync(SIGNOFFS_PATH)) {
            try {
              res.statusCode = 200
              res.end(readFileSync(SIGNOFFS_PATH, 'utf-8'))
            } catch (err) {
              res.statusCode = 500
              res.end(JSON.stringify({ ok: false, error: String(err) }))
            }
          } else {
            res.statusCode = 200
            res.end(JSON.stringify({ schema_version: 'pdf_lab.signoff_export.v1', signoffs: {} }))
          }
          return
        }
        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'unknown signoffs endpoint' }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), chatterboxArtifactsPlugin(), pdfLabSignoffsPlugin(), transportReviewBundlePlugin()],
  resolve: {
    alias: {
      // Import skill components directly — no duplication
      '@skills': resolve(__dirname, '../../.pi/skills'),
      // Pi chat adapter — D-Bus bridge package
      '@pi-chat-adapter': resolve(__dirname, '../pi-chat-adapter/src'),
      // Map NVIS theme to EMBRY shim so skill components use Explorer's design system
      '@skills-theme': resolve(__dirname, 'src/components/sparta/common/nvis-shim.ts'),
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    watch: {
      usePolling: process.env.UX_LAB_USE_POLLING !== '0',
      interval: Number(process.env.UX_LAB_WATCH_INTERVAL_MS ?? 1000),
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/test-results/**',
        '**/captures/**',
        '**/dist/**',
        '**/public/pdf-lab-evidence/**',
        '**/public/pdf-lab-pages/**',
        '**/public/sparta-artifacts/**',
        '**/public/artifacts/**',
        '**/public/**/*-extraction.json',
      ],
    },
    proxy: {
      '/api': {
        target: uxLabApiTarget,
        changeOrigin: true,
      },
      '/artifacts': {
        target: uxLabApiTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: uxLabWsTarget,
        ws: true,
      },
      '/test-results': {
        target: uxLabApiTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    alias: {
      // Redirect fabric to fabric/node in tests (provides document/window stubs for Textbox)
      fabric: resolve(__dirname, '../../node_modules/fabric/dist/index.node.mjs'),
    },
  },
})
