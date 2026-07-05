import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { createReadStream, statSync, existsSync } from 'fs'
import type { Plugin } from 'vite'

const resolveWorkspaceModule = (modulePath: string) => {
  const localPath = resolve(__dirname, 'node_modules', modulePath)
  if (existsSync(localPath)) return localPath
  return resolve(__dirname, '../../node_modules', modulePath)
}

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

export default defineConfig({
  plugins: [react(), tailwindcss(), chatterboxArtifactsPlugin()],
  resolve: {
    alias: {
      // Import skill components directly — no duplication
      '@skills': resolve(__dirname, '../../.pi/skills'),
      // Map NVIS theme to EMBRY shim so skill components use Explorer's design system
      '@skills-theme': resolve(__dirname, 'src/components/sparta/common/nvis-shim.ts'),
      '@embry/logo': resolve(__dirname, '../../../embry-os/packages/embry-logo/src'),
      react: resolveWorkspaceModule('react'),
      'react-dom': resolveWorkspaceModule('react-dom'),
      'react/jsx-runtime': resolveWorkspaceModule('react/jsx-runtime'),
      'react/jsx-dev-runtime': resolveWorkspaceModule('react/jsx-dev-runtime'),
      'framer-motion': resolveWorkspaceModule('framer-motion'),
      'lucide-react': resolveWorkspaceModule('lucide-react'),
    },
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'framer-motion', 'lucide-react'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/test-results': {
        target: 'http://localhost:3001',
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
