import { spawn } from 'node:child_process'
import net from 'node:net'

const host = process.env.UX_LAB_HOST ?? '127.0.0.1'
const requestedApiPort = Number(process.env.UX_LAB_API_PORT ?? process.env.PORT ?? 3001)
const requestedUiPort = Number(process.env.UX_LAB_UI_PORT ?? 3002)

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

async function findAvailablePort(start, reserved = new Set()) {
  for (let port = start; port < start + 50; port += 1) {
    if (reserved.has(port)) continue
    if (await canListen(port)) return port
  }
  throw new Error(`No available port found from ${start} through ${start + 49}`)
}

const apiPort = await findAvailablePort(requestedApiPort)
const uiPort = await findAvailablePort(requestedUiPort, new Set([apiPort]))
const env = {
  ...process.env,
  HOST: host,
  PORT: String(apiPort),
  UX_LAB_API_PORT: String(apiPort),
  UX_LAB_USE_POLLING: process.env.UX_LAB_USE_POLLING ?? '1',
}

const children = [
  spawn('npx', ['vite', '--host', host, '--port', String(uiPort)], { stdio: 'inherit', env }),
  spawn('npx', ['tsx', 'watch', 'server/index.ts'], { stdio: 'inherit', env }),
]

console.log(`UX Lab UI requested on http://${host}:${uiPort}`)
console.log(`UX Lab API requested on http://${host}:${apiPort}`)

function shutdown(signal) {
  for (const child of children) child.kill(signal)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (code && code !== 0) {
      shutdown('SIGTERM')
      process.exitCode = code
    }
    if (signal) shutdown(signal)
  })
}
