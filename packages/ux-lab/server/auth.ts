/**
 * Simple access key authentication for external SPARTA Explorer access.
 *
 * - Localhost requests bypass auth entirely
 * - External requests require ?key= param or Authorization: Bearer header
 * - Keys expire after a configurable TTL (default 24 hours)
 * - Developer regenerates keys via: npm run key:generate [--hours 48]
 *
 * Keys stored in ~/.sparta-access-keys.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomBytes } from 'crypto'
import { resolve } from 'path'
import type { Request, Response, NextFunction } from 'express'

const KEYS_FILE = resolve(process.env.HOME ?? '/home/graham', '.sparta-access-keys.json')
const DEFAULT_TTL_HOURS = 24

interface AccessKey {
  key: string
  created: string
  expires: string
  label?: string
  project?: string  // e.g. 'sparta-explorer', 'embry-dashboard'. Omit = all projects.
}

interface KeyStore {
  keys: AccessKey[]
}

function loadKeys(): KeyStore {
  if (!existsSync(KEYS_FILE)) return { keys: [] }
  try {
    return JSON.parse(readFileSync(KEYS_FILE, 'utf-8'))
  } catch {
    return { keys: [] }
  }
}

function saveKeys(store: KeyStore): void {
  writeFileSync(KEYS_FILE, JSON.stringify(store, null, 2))
}

/**
 * Generate a new access key with expiry.
 */
export function generateKey(hours: number = DEFAULT_TTL_HOURS, label?: string, project?: string): AccessKey {
  const key = randomBytes(24).toString('base64url')
  const now = new Date()
  const expires = new Date(now.getTime() + hours * 60 * 60 * 1000)

  const entry: AccessKey = {
    key,
    created: now.toISOString(),
    expires: expires.toISOString(),
    label,
    project,
  }

  const store = loadKeys()
  // Remove expired keys while we're at it
  store.keys = store.keys.filter(k => new Date(k.expires) > now)
  store.keys.push(entry)
  saveKeys(store)

  return entry
}

/**
 * List active (non-expired) keys.
 */
export function listKeys(): AccessKey[] {
  const store = loadKeys()
  const now = new Date()
  return store.keys.filter(k => new Date(k.expires) > now)
}

/**
 * Revoke all keys.
 */
export function revokeAll(): number {
  const store = loadKeys()
  const count = store.keys.length
  store.keys = []
  saveKeys(store)
  return count
}

/**
 * Validate a key. Returns true if the key exists and hasn't expired.
 */
/**
 * Validate a key, optionally scoped to a project.
 * A key with no project grants access to all projects.
 * A key with a project only grants access to that project.
 */
function isValidKey(key: string, project?: string): boolean {
  const store = loadKeys()
  const now = new Date()
  return store.keys.some(k => {
    if (k.key !== key || new Date(k.expires) <= now) return false
    // No project on key = access to all projects
    if (!k.project) return true
    // No project requested = only unscoped keys match
    if (!project) return false
    return k.project === project
  })
}

/**
 * Check if a request is from localhost.
 */
function isLocalhost(req: Request): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? ''
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost'
}

/**
 * Check if IP is in Tailscale CGNAT range (100.64.0.0/10).
 * Tailscale assigns addresses in 100.64.0.0 – 100.127.255.255.
 */
function isTailscaleIP(ip: string): boolean {
  const raw = ip.replace('::ffff:', '')
  const parts = raw.split('.')
  if (parts.length !== 4) return false
  const first = parseInt(parts[0], 10)
  const second = parseInt(parts[1], 10)
  return first === 100 && second >= 64 && second <= 127
}

/**
 * Get Tailscale user identity for an IP via `tailscale whois`.
 * Returns the login name or null if lookup fails.
 */
let whoisCache = new Map<string, { user: string | null, ts: number }>()
const WHOIS_CACHE_TTL = 300_000 // 5 minutes

async function tailscaleWhois(ip: string): Promise<string | null> {
  const raw = ip.replace('::ffff:', '')
  const cached = whoisCache.get(raw)
  if (cached && Date.now() - cached.ts < WHOIS_CACHE_TTL) return cached.user

  try {
    const { execSync } = await import('child_process')
    const out = execSync(`tailscale whois --json ${raw}`, { timeout: 3000 }).toString()
    const data = JSON.parse(out)
    const user = data?.UserProfile?.LoginName ?? data?.UserProfile?.DisplayName ?? null
    whoisCache.set(raw, { user, ts: Date.now() })
    return user
  } catch {
    whoisCache.set(raw, { user: null, ts: Date.now() })
    return null
  }
}

/**
 * Express middleware: skip auth for localhost and Tailscale, require key for external.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Localhost always passes
  if (isLocalhost(req)) {
    next()
    return
  }

  const clientIP = req.ip ?? req.socket.remoteAddress ?? ''
  const viaTailscale = isTailscaleIP(clientIP)

  // Check ?key= query param — set cookie on success so client doesn't need it again
  const queryKey = req.query.key as string | undefined
  if (queryKey && isValidKey(queryKey)) {
    // Set cookie so subsequent requests don't need the key in the URL
    res.cookie('sparta_key', queryKey, {
      httpOnly: true,
      secure: viaTailscale, // Tailscale serve provides HTTPS
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24h
    })
    // Log Tailscale user identity on first key auth
    if (viaTailscale) {
      tailscaleWhois(clientIP).then(user => {
        if (user) console.log(`[tailscale] ${user} (${clientIP.replace('::ffff:', '')}) authenticated with key`)
      }).catch(() => {})
    }
    next()
    return
  }

  // Check Authorization: Bearer header
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    const bearerKey = authHeader.slice(7)
    if (isValidKey(bearerKey)) {
      next()
      return
    }
  }

  // Check cookie (set after first successful ?key= auth)
  const cookieKey = req.cookies?.sparta_key
  if (cookieKey && isValidKey(cookieKey)) {
    next()
    return
  }

  // No valid key — return 401 with a clean login page
  res.status(401).send(`<!DOCTYPE html>
<html><head><title>SPARTA Explorer — Access Required</title>
<style>
  body { font-family: system-ui; background: #0f172a; color: #e2e8f0; display: flex;
         align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #1e293b; padding: 2rem; border-radius: 0.5rem; max-width: 400px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  input { width: 100%; padding: 0.5rem; border-radius: 0.25rem; border: 1px solid #475569;
          background: #0f172a; color: #e2e8f0; font-size: 1rem; box-sizing: border-box; }
  button { margin-top: 0.75rem; padding: 0.5rem 1.5rem; background: #3b82f6; color: white;
           border: none; border-radius: 0.25rem; cursor: pointer; font-size: 1rem; }
  button:hover { background: #2563eb; }
  .error { color: #f87171; font-size: 0.875rem; margin-top: 0.5rem; }
</style></head>
<body><div class="card">
  <h1>SPARTA Explorer</h1>
  <p style="color:#94a3b8;font-size:0.875rem">Enter your access key to continue.</p>
  <form method="GET" action="/">
    <input name="key" placeholder="Access key" autofocus />
    <button type="submit">Enter</button>
  </form>
  <p class="error">Invalid or expired access key.</p>
</div></body></html>`)
}
