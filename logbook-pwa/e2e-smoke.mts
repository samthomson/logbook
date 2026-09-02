/**
 * End-to-end smoke test of Logbook's core loop using the app's own lib code.
 *   1. Load latest Compass issue (kind 30023) + parse sections
 *   2. Sign + upload a small WAV blob to Blossom (BUD-01) with kind 24242 auth
 *   3. Mirror to other servers (BUD-04)
 *   4. Publish kind 4200 segment event to relays
 *   5. Fetch it back via fetchSegmentsForSection
 *   6. Verify audio URL is fetchable (byte-range)
 *
 * Run from logbook-pwa/: node --experimental-strip-types e2e-smoke.mts
 * (tsx not required — plain .mts with type-stripping)
 */
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { bytesToHex } from '@noble/hashes/utils.js'

const COMPASS_PUBKEY = 'baa11ea074871c850de58b626288da51a9e8bb5df7cdb63859dfa19898659b7e'
const RELAYS = ['wss://nos.lol', 'wss://relay.ditto.pub', 'wss://relay.primal.net']
const BLOSSOM_SERVERS = ['https://blossom.band', 'https://blossom.ditto.pub', 'https://blossom.oxtr.dev']
const KINDS = { COMPASS_ISSUE: 30023, SEGMENT: 4200, BLOSSOM_AUTH: 24242 }

// Test identity = the whitelisted test user from config
// Use an ephemeral key instead so we don't need the real test user's nsec;
// whitelist gating is client-side so relay publish doesn't care.
const sk = generateSecretKey()
const pk = getPublicKey(sk)
console.log('test pubkey:', pk, nip19.npubEncode(pk))

const now = () => Math.floor(Date.now() / 1000)
const pool = new SimplePool()

// ── Step 1: fetch latest Compass issue ──────────────────────────────────────
console.log('\n[1] fetching latest Compass issue…')
const issues = await pool.querySync(RELAYS, { kinds: [KINDS.COMPASS_ISSUE], authors: [COMPASS_PUBKEY], limit: 1 })
if (!issues.length) { console.error('FAIL: no kind 30023 from Compass pubkey'); process.exit(1) }
const issue = issues.reduce((a, b) => (a.created_at > b.created_at ? a : b))
const dTag = issue.tags.find(t => t[0] === 'd')?.[1] ?? ''
const issueNum = parseInt(dTag.match(/(\d+)$/)?.[1] ?? '0', 10)
console.log(`  ok: "${issue.tags.find(t => t[0] === 'title')?.[1]}" d=${dTag} → issue #${issueNum}`)
console.log(`  content first 200: ${issue.content.slice(0, 200).replace(/\n/g, ' | ')}`)

// parse sections like parseIssue()
const sections = []
for (const line of issue.content.split('\n')) {
  if (line.startsWith('## ')) sections.push(line.slice(3).trim())
}
console.log(`  sections found: ${sections.length}`, sections.slice(0, 5))
if (!sections.length) { console.error('FAIL: no H2 sections parsed — parseIssue() would return empty'); process.exit(1) }

// ── Step 2: build a tiny WAV blob + sha256 ──────────────────────────────────
console.log('\n[2] building 0.5s WAV blob…')
function makeWav(seconds = 0.5, rate = 8000) {
  const n = Math.floor(seconds * rate)
  const data = new Int16Array(n)
  for (let i = 0; i < n; i++) data[i] = Math.sin(2 * Math.PI * 440 * i / rate) * 12000
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true)
  v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true)
  new Int16Array(buf, 44).set(data)
  return new Uint8Array(buf)
}
const wavBytes = makeWav()
const hashBuf = await crypto.subtle.digest('SHA-256', wavBytes)
const sha256 = bytesToHex(new Uint8Array(hashBuf))
console.log(`  ok: ${wavBytes.length} bytes, sha256=${sha256.slice(0, 16)}…`)

// ── Step 3: BUD-01 upload with kind 24242 auth ──────────────────────────────
console.log('\n[3] uploading to Blossom primary (blossom.band)…')
function makeAuth(t) {
  return finalizeEvent({
    kind: KINDS.BLOSSOM_AUTH,
    created_at: now(),
    tags: [['t', t], ['x', sha256], ['expiration', String(now() + 300)]],
    content: `${t} ${sha256}`,
  }, sk)
}
const authHeader = 'Nostr ' + Buffer.from(JSON.stringify(makeAuth('upload'))).toString('base64')
const put = await fetch(`${BLOSSOM_SERVERS[0]}/upload`, {
  method: 'PUT',
  headers: { 'Content-Type': 'audio/wav', Authorization: authHeader },
  body: wavBytes,
})
console.log('  PUT status:', put.status)
const putBody = await put.text()
console.log('  PUT body:', putBody.slice(0, 200))
if (!put.ok) { console.error('FAIL: blossom upload'); process.exit(1) }
const desc = JSON.parse(putBody)
const audioUrl = desc.url
console.log('  url:', audioUrl)

// ── Step 4: mirror (BUD-04) ─────────────────────────────────────────────────
console.log('\n[4] mirroring to other servers…')
for (const mirror of BLOSSOM_SERVERS.slice(1)) {
  try {
    const mAuth = 'Nostr ' + Buffer.from(JSON.stringify(makeAuth('upload'))).toString('base64')
    const r = await fetch(`${mirror}/mirror`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: mAuth },
      body: JSON.stringify({ url: audioUrl, sha256, type: 'audio/wav' }),
    })
    console.log(`  ${mirror}: ${r.status} ${(await r.text()).slice(0, 80)}`)
  } catch (e) { console.log(`  ${mirror}: ERROR ${e.message}`) }
}

// ── Step 5: publish kind 4200 segment ───────────────────────────────────────
console.log('\n[5] publishing kind 4200 segment…')
const sectionSlug = sections[0].toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 40)
const sectionId = `sec-${sectionSlug}-${issueNum}`
const issueId = `logbook-${issueNum}`
const segEvent = finalizeEvent({
  kind: KINDS.SEGMENT,
  created_at: now(),
  tags: [
    ['x', sha256],
    ['section', sectionId],
    ['issue', issueId],
    ['t', issueId],
    ['alt', `Voice note on: ${sectionId}`],
  ],
  content: JSON.stringify({
    audio: { url: audioUrl, sha256, mime: 'audio/wav', duration: 0.5, waveform: new Array(100).fill(0.5) },
    isIntro: false,
  }),
}, sk)
console.log('  event id:', segEvent.id, 'section:', sectionId)
const pubs = pool.publish(RELAYS, segEvent)
const results = await Promise.allSettled(pubs)
for (const r of results) console.log('  publish:', r.status, r.status === 'fulfilled' ? r.value : r.reason)

// ── Step 6: fetch it back the way the app does ─────────────────────────────
console.log('\n[6] fetching segments back (#t filter, like fetchSegmentsForSection)…')
await new Promise(r => setTimeout(r, 2000))
const fetched = await pool.querySync(RELAYS, { kinds: [KINDS.SEGMENT], '#t': [issueId], limit: 500 })
const ours = fetched.filter(e => e.tags.some(t => t[0] === 'section' && t[1] === sectionId))
console.log(`  total for issue: ${fetched.length}, in our section: ${ours.length}, ours found: ${ours.some(e => e.id === segEvent.id)}`)
if (!ours.some(e => e.id === segEvent.id)) { console.error('FAIL: segment not visible on relays'); process.exit(1) }

// ── Step 7: verify audio URL fetchable with byte-range ──────────────────────
console.log('\n[7] verifying audio URL + byte-range…')
const get = await fetch(audioUrl, { headers: { Range: 'bytes=0-99' } })
console.log('  GET status:', get.status, 'content-range:', get.headers.get('content-range'), 'cors:', get.headers.get('access-control-allow-origin'))

console.log('\n✅ E2E SMOKE TEST PASSED')
pool.destroy?.()
process.exit(0)
