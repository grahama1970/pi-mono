/** Dev-server git diff for transport Copy for review bundles. */
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const REPO_ROOT = resolve(__dirname, '../..')
const TRANSPORT_DIR = 'packages/ux-lab/src/components/scillm/transport'

import { FOCUSED_TRANSPORT_REVIEW_FILES } from '../src/components/scillm/transport/transportReviewBundle.constants'

function pathspecs(files: readonly string[]): string[] {
  return files.map((f) => `${TRANSPORT_DIR}/${f}`)
}

function runGit(args: string): string {
  return execSync(args, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 12 * 1024 * 1024,
  }).trimEnd()
}

function gitFocusedDiff(): { stat: string; diff: string; files: string[] } {
  const specs = pathspecs(FOCUSED_TRANSPORT_REVIEW_FILES)
  const quoted = specs.map((p) => `"${p}"`).join(' ')
  const stat = runGit(`git diff --stat HEAD -- ${quoted}`)
  const diff = runGit(`git diff HEAD -- ${quoted}`)
  return { stat, diff, files: [...FOCUSED_TRANSPORT_REVIEW_FILES] }
}

export function transportReviewBundlePlugin(): Plugin {
  return {
    name: 'transport-review-bundle',
    configureServer(server) {
      server.middlewares.use('/ux-lab-api/transport-review', (req, res) => {
        if (req.method !== 'GET' || !req.url?.startsWith('/diff')) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: 'unknown transport-review endpoint' }))
          return
        }
        try {
          const { stat, diff, files } = gitFocusedDiff()
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              ok: true,
              repo_root: REPO_ROOT,
              path_prefix: TRANSPORT_DIR,
              files,
              stat,
              diff,
              empty: !diff.trim(),
            }),
          )
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: String(err) }))
        }
      })
    },
  }
}
