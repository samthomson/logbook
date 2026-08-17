/**
 * Seed kind 34201 standing roster + admins via the NIP-46 bunker.
 *
 * Usage: npm run seed-whitelist
 */

import { readFileSync } from 'node:fs'
import { SimplePool } from 'nostr-tools/pool'
import { verifyNostrEvent } from './segment-security.ts'
import { createCompassAmberSigner } from './amber-signer.ts'
import {
  COMPASS_PUBKEY,
  RELAYS,
  D_ADMINS,
  D_STANDING,
  KINDS,
} from './config.ts'

const HEX_64 = /^[0-9a-f]{64}$/

function parseStandingRoster(): Array<{ pubkey: string; name?: string }> {
  const yml = readFileSync(new URL('../logbook-pwa/public/data/npubs.yml', import.meta.url), 'utf8')
  const standing: Array<{ pubkey: string; name?: string }> = []
  let currentName: string | null = null
  for (const line of yml.split('\n')) {
    const t = line.trim().replace(/^-\s*/, '')
    if (t.startsWith('name:')) {
      currentName = t.slice(5).trim().replace(/^["']|["']$/g, '')
    } else if (t.startsWith('pubkey:')) {
      const hex = t.slice(7).trim().replace(/^["']|["']$/g, '').toLowerCase()
      if (HEX_64.test(hex)) standing.push({ pubkey: hex, name: currentName ?? undefined })
      currentName = null
    }
  }
  return standing
}

function adminPubkeys(): string[] {
  const raw = process.env.ADMIN_PUBKEYS ?? ''
  const fromEnv = raw.split(',').map((v) => v.trim().toLowerCase()).filter((v) => HEX_64.test(v))
  return [...new Set([COMPASS_PUBKEY, ...fromEnv])]
}

async function existingContent(dTag: string): Promise<string | null> {
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(
      RELAYS,
      { kinds: [KINDS.WHITELIST], authors: [COMPASS_PUBKEY], '#d': [dTag], limit: 5 },
      { maxWait: 15_000 },
    )
    const newest = events
      .filter((event) => event.pubkey === COMPASS_PUBKEY && verifyNostrEvent(event))
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0]
    return newest ? newest.content : null
  } finally {
    pool.close(RELAYS)
  }
}

const standing = parseStandingRoster()
const admins = adminPubkeys().map((pubkey) => ({ pubkey }))
const signer = createCompassAmberSigner()
const pool = new SimplePool()

try {
  for (const [dTag, content] of [
    [D_STANDING, JSON.stringify({ contributors: standing })],
    [D_ADMINS, JSON.stringify({ admins: admins.map((a) => a.pubkey) })],
  ] as const) {
    // Republish when the desired list differs, so adding an ADMIN_PUBKEYS entry
    // actually reaches the relay instead of being skipped forever.
    const published = await existingContent(dTag)
    if (published === content) {
      console.log(`SKIP ${dTag} — already published and unchanged`)
      continue
    }
    const signed = await signer.signEvent({
      kind: KINDS.WHITELIST,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', dTag], ['alt', `Logbook whitelist: ${dTag}`]],
      content,
    })
    await Promise.any(pool.publish(RELAYS, signed))
    console.log(`PUBLISHED ${dTag} — event ${signed.id.slice(0, 16)}…`)
  }
} finally {
  pool.close(RELAYS)
}

process.exit(0)
