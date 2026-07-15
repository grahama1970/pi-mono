import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { createReadStream, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, existsSync } from 'fs'
import type { Plugin } from 'vite'
import { transportReviewBundlePlugin } from './plugins/transportReviewBundlePlugin'

const resolveWorkspaceModule = (modulePath: string) => {
  const localPath = resolve(__dirname, 'node_modules', modulePath)
  if (existsSync(localPath)) return localPath
  return resolve(__dirname, '../../node_modules', modulePath)
}

const agentSkillsReleaseRoot = realpathSync('/mnt/storage12tb/deployments/agent-skills/current')
const agentSkillsReleaseId = agentSkillsReleaseRoot.split('/').at(-1) ?? 'current'
const battleSpectatorRoot = resolve(agentSkillsReleaseRoot, 'skills/battle/spectator')
const deploymentCacheDir = resolve(__dirname, 'node_modules/.vite', `agent-skills-${agentSkillsReleaseId}`)

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

function tauDagLiveRunPlugin(): Plugin {
  const TAU_ROOT = resolve(process.env.TAU_PROJECT_ROOT ?? '/home/graham/workspace/experiments/tau')
  const DEFAULT_RUN_ROOT = resolve(TAU_ROOT, 'experiments/goal-locked-subagents/proofs')
  const RUN_ROOT = resolve(process.env.TAU_DAG_RUN_ROOT ?? DEFAULT_RUN_ROOT)
  const ALLOWED_ROOTS = [TAU_ROOT, '/tmp'].map((entry) => realpathSync(entry))

  const insideAllowedRoot = (absolutePath: string) => {
    const realPath = realpathSync(absolutePath)
    return ALLOWED_ROOTS.some((root) => realPath === root || realPath.startsWith(`${root}/`))
  }

  const readJsonFile = (path: string) => JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>

  const resolveExistingFile = (runDir: string, candidates: string[]) => {
    for (const candidate of candidates) {
      const absolutePath = resolve(runDir, candidate)
      if (existsSync(absolutePath) && statSync(absolutePath).isFile()) return absolutePath
    }
    return null
  }

  const findDagFiles = (runDir: string) => {
    const contractPath = resolveExistingFile(runDir, [
      'dag-contract.json',
      'project-dag-contract.json',
      'contract/dag-contract.json',
    ])
    const receiptPath = resolveExistingFile(runDir, [
      'dag-receipt.json',
      'run/dag-receipt.json',
      'receipts/dag-receipt.json',
    ])
    return { contractPath, receiptPath }
  }

  return {
    name: 'tau-dag-live-run',
    configureServer(server) {
      server.middlewares.use('/tau-dag-live-run', (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          const runParam = url.searchParams.get('run')?.trim()
          if (!runParam) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: 'run query parameter is required' }))
            return
          }

          const runDir = resolve(runParam.startsWith('/') ? runParam : resolve(RUN_ROOT, runParam))
          if (!existsSync(runDir) || !statSync(runDir).isDirectory()) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: 'Tau DAG run directory not found', runDir }))
            return
          }
          if (!insideAllowedRoot(runDir)) {
            res.statusCode = 403
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: 'Tau DAG run is outside allowed roots', runDir }))
            return
          }

          const { contractPath, receiptPath } = findDagFiles(runDir)
          if (!contractPath || !receiptPath) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              ok: false,
              error: 'Tau DAG run is missing dag-contract.json or dag-receipt.json',
              runDir,
              searched: [
                'dag-contract.json',
                'project-dag-contract.json',
                'contract/dag-contract.json',
                'dag-receipt.json',
                'run/dag-receipt.json',
                'receipts/dag-receipt.json',
              ],
            }))
            return
          }

          const label = runDir.split('/').filter(Boolean).at(-1) ?? 'Tau DAG run'
          const payload = {
            ok: true,
            schema: 'ux_lab.tau_dag_live_run_bundle.v1',
            manifest: {
              schema: 'ux_lab.tau_dag_run_manifest.v1',
              defaultRunId: runParam,
              runs: [{
                id: runParam,
                label,
                path: runDir,
                source: 'live_local_tau_run',
                source_repo: TAU_ROOT,
              }],
            },
            selected: {
              id: runParam,
              label,
              path: runDir,
              source: 'live_local_tau_run',
              source_repo: TAU_ROOT,
            },
            contract: readJsonFile(contractPath),
            receipt: readJsonFile(receiptPath),
            artifact_paths: {
              run_dir: runDir,
              contract: contractPath,
              receipt: receiptPath,
            },
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(payload))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: 'Tau DAG live run load failed', detail: String(err) }))
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
  cacheDir: deploymentCacheDir,
  optimizeDeps: {
    entries: ['index.html', 'src/components/battle/BattleArenaView.tsx'],
  },
  plugins: [react(), tailwindcss(), chatterboxArtifactsPlugin(), tauDagLiveRunPlugin(), pdfLabSignoffsPlugin(), transportReviewBundlePlugin()],
  resolve: {
    alias: {
      // Import skill components directly — no duplication
      '@skills': resolve(__dirname, '../../.pi/skills'),
      '@agent-skills/ux-lab-ui': resolve(__dirname, '../../../agent-skills/skills/ux-lab/ui'),
      '@agent-skills/persona-dream-ui': resolve(__dirname, '../../../agent-skills-main/skills/persona-dream/ui/src'),
      '@agent-skills/battle-spectator': resolve(battleSpectatorRoot, 'src'),
      // Pi chat adapter — D-Bus bridge package
      '@pi-chat-adapter': resolve(__dirname, '../pi-chat-adapter/src'),
      // Map NVIS theme to EMBRY shim so skill components use Explorer's design system
      '@skills-theme': resolve(__dirname, 'src/components/sparta/common/nvis-shim.ts'),
      '@embry/logo': resolve(__dirname, '../../../embry-os/packages/embry-logo/src'),
      // Monorepo: ux-lab must not bundle a second React copy (invalid hook call)
      react: resolveWorkspaceModule('react'),
      'react-dom': resolveWorkspaceModule('react-dom'),
      'react/jsx-runtime': resolveWorkspaceModule('react/jsx-runtime'),
      'react/jsx-dev-runtime': resolveWorkspaceModule('react/jsx-dev-runtime'),
      'framer-motion': resolveWorkspaceModule('framer-motion'),
      '@radix-ui/react-dialog': resolveWorkspaceModule('@radix-ui/react-dialog'),
      '@radix-ui/react-popover': resolveWorkspaceModule('@radix-ui/react-popover'),
      '@radix-ui/react-slot': resolveWorkspaceModule('@radix-ui/react-slot'),
      '@radix-ui/react-tabs': resolveWorkspaceModule('@radix-ui/react-tabs'),
      '@radix-ui/react-toggle-group': resolveWorkspaceModule('@radix-ui/react-toggle-group'),
      '@radix-ui/react-tooltip': resolveWorkspaceModule('@radix-ui/react-tooltip'),
      'class-variance-authority': resolveWorkspaceModule('class-variance-authority'),
      clsx: resolveWorkspaceModule('clsx'),
      'lucide-react': resolveWorkspaceModule('lucide-react'),
      d3: resolveWorkspaceModule('d3'),
      motion: resolveWorkspaceModule('motion'),
      'ajv/dist/2020.js': resolveWorkspaceModule('ajv/dist/2020.js'),
      'ajv-formats': resolveWorkspaceModule('ajv-formats'),
      'pixi.js': resolveWorkspaceModule('pixi.js'),
      'pixi-viewport': resolveWorkspaceModule('pixi-viewport'),
      'sonner': resolveWorkspaceModule('sonner'),
      'tailwind-merge': resolveWorkspaceModule('tailwind-merge'),
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'framer-motion', 'motion', 'lucide-react', 'd3'],
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    warmup: {
      clientFiles: ['./src/components/battle/BattleArenaView.tsx'],
    },
    fs: {
      allow: [resolve(__dirname, '../..'), battleSpectatorRoot],
    },
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
