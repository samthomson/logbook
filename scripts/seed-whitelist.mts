/**
 * Seed the initial kind 34201 whitelist events (standing roster + admins)
 * from the legacy static files / config bootstrap.
 *
 * Usage:
 *   COMPASS_NSEC=nsec1... npx tsx scripts/seed-whitelist.mts
 *
 * Idempotent: fetches existing events first and skips any d-tag that
 * already has a verified Compass-authored event.
 */

import { connectNsec } from '../logbook-pwa/src/lib/auth'
import {
  fetchWhitelistEntries,
  publishWhitelist,
  normalizeToHex,
  type WhitelistEntry,
} from '../logbook-pwa/src/lib/whitelist'
import { D_STANDING, D_ADMINS, ADMIN_PUBKEYS, COMPASS_PUBKEY } from '../logbook-pwa/src/config'
import { readFileSync } from 'node:fs'

const nsec = process.env.COMPASS_NSEC
if (!nsec) {
  console.error('Set COMPASS_NSEC')
  process.exit(1)
}

const auth = await connectNsec(nsec)
if (auth.pubkey !== COMPASS_PUBKEY) {
  console.error(`Key mismatch: logged in as ${auth.pubkey.slice(0, 12)}…, expected Compass key`)
  process.exit(1)
}

// Standing roster from legacy npubs.yml
const yml = readFileSync(new URL('../logbook-pwa/public/data/npubs.yml', import.meta.url), 'utf8')
const standing: WhitelistEntry[] = []
let currentName: string | null = null
for (const line of yml.split('\n')) {
  const t = line.trim().replace(/^-\s*/, '')
  if (t.startsWith('name:')) {
    currentName = t.slice(5).trim().replace(/^["']|["']$/g, '')
  } else if (t.startsWith('pubkey:')) {
    const hex = normalizeToHex(t.slice(7).trim().replace(/^["']|["']$/g, ''))
    if (hex) standing.push({ pubkey: hex, name: currentName ?? undefined })
    currentName = null
  }
}

const admins: WhitelistEntry[] = ADMIN_PUBKEYS.map((pubkey) => ({ pubkey }))

for (const [dTag, entries] of [[D_STANDING, standing], [D_ADMINS, admins]] as const) {
  const existing = await fetchWhitelistEntries(dTag)
  if (existing.length > 0) {
    console.log(`SKIP ${dTag} — already has ${existing.length} entries on-chain`)
    continue
  }
  const ev = await publishWhitelist(dTag, entries, auth.signer)
  console.log(`PUBLISHED ${dTag} — ${entries.length} entries, event ${ev.id.slice(0, 16)}…`)
}

process.exit(0)
