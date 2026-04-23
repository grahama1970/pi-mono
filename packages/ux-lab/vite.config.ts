import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    port: 3000,
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/test-results/**',
        '**/captures/**',
        '**/dist/**',
        '**/public/**/*-extraction.json',
      ],
    },
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
