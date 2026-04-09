#!/usr/bin/env tsx
/**
 * Generate a new access key for external SPARTA Explorer access.
 *
 * Usage:
 *   npx tsx server/generate-key.ts              # 24h key
 *   npx tsx server/generate-key.ts --hours 48   # 48h key
 *   npx tsx server/generate-key.ts --list       # list active keys
 *   npx tsx server/generate-key.ts --revoke     # revoke all keys
 */

import { generateKey, listKeys, revokeAll } from './auth.js'

const args = process.argv.slice(2)

if (args.includes('--list')) {
  const keys = listKeys()
  if (keys.length === 0) {
    console.log('No active keys.')
  } else {
    console.log(`\n  Active keys (${keys.length}):\n`)
    for (const k of keys) {
      const expires = new Date(k.expires)
      const hoursLeft = Math.max(0, (expires.getTime() - Date.now()) / 3600000)
      console.log(`  Key:     ${k.key}`)
      console.log(`  Label:   ${k.label ?? 'none'}`)
      console.log(`  Expires: ${expires.toISOString()} (${hoursLeft.toFixed(1)}h left)`)
      console.log()
    }
  }
  process.exit(0)
}

if (args.includes('--revoke')) {
  const count = revokeAll()
  console.log(`Revoked ${count} key(s).`)
  process.exit(0)
}

const hoursIdx = args.indexOf('--hours')
const hours = hoursIdx >= 0 ? Number(args[hoursIdx + 1]) || 24 : 24

const labelIdx = args.indexOf('--label')
const label = labelIdx >= 0 ? args[labelIdx + 1] : 'client'

const key = generateKey(hours, label)

console.log(`
  Access key generated.

  Key:     ${key.key}
  Expires: ${key.expires} (${hours}h)
  Label:   ${label}

  Share with client:
    http://<your-ip>:3001/?key=${key.key}#sparta-explorer

  Or for production build:
    http://<your-ip>:3001/?key=${key.key}

  The client enters this URL in their browser — no install needed.
  Key expires automatically after ${hours} hours.

  Manage keys:
    npx tsx server/generate-key.ts --list     # show active keys
    npx tsx server/generate-key.ts --revoke   # revoke all keys
`)
