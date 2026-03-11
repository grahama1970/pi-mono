import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  test: {
    globals: true,
    environment: 'node',
    alias: {
      // Redirect fabric to fabric/node in tests (provides document/window stubs for Textbox)
      fabric: resolve(__dirname, '../../node_modules/fabric/dist/index.node.mjs'),
    },
  },
})
