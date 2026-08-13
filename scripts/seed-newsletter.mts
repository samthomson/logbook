/**
 * Publish a kind 30023 newsletter so an isolated stack has an issue to work
 * from. This is the input the watcher waits for: without one, no manifest is
 * created and the contributor flow has nothing to attach recordings to.
 *
 * Signing goes through the authorized Compass NIP-46 session, exactly as
 * production does, so a seeded run exercises the real signer path.
 *
 * Refuses to run against the production Compass identity: seeding fabricated
 * issues under the real key would publish a fake newsletter to public relays.
 *
 * Usage:
 *   npm run seed-newsletter -- <issueNumber> [--title "Some title"]
 */

import { SimplePool } from 'nostr-tools/pool'
import { COMPASS_PUBKEY, RELAYS, KINDS } from './config.ts'
import { REAL_COMPASS_PUBKEY } from './config-env.ts'
import { createCompassAmberSigner } from './amber-signer.ts'
import { requiredChapterTargets } from './issue-targets.ts'

const args = process.argv.slice(2)
const issueNumber = Number.parseInt(args[0] ?? '', 10)
if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
  console.error('Usage: npm run seed-newsletter -- <issueNumber> [--title "Some title"]')
  process.exit(1)
}

const titleIndex = args.indexOf('--title')
const title = titleIndex >= 0 ? args[titleIndex + 1] : `Test Compass #${issueNumber}`
if (titleIndex >= 0 && !title) {
  console.error('--title requires a value')
  process.exit(1)
}

if (COMPASS_PUBKEY === REAL_COMPASS_PUBKEY) {
  console.error(
    'Refusing to seed: COMPASS_PUBKEY is the production Compass identity.\n' +
    'Set it to a burner key before seeding a newsletter.',
  )
  process.exit(1)
}

// H2 becomes a chapter group, H3 a recording target within it. A group whose
// lead prose is empty contributes no chapter of its own, so every group here
// carries prose to keep the seeded issue's chapter list predictable.
const content = [
  `## Lead stories`,
  `The stories that opened issue ${issueNumber}, narrated as the section lead.`,
  ``,
  `### Relay operations`,
  `What changed for relay operators this week.`,
  ``,
  `### Client releases`,
  `Notable client updates worth a comment.`,
  ``,
  `## Apps & Clients`,
  `A short lead paragraph for the apps section.`,
  ``,
  `### Blossom media`,
  `Media hosting changes across Blossom servers.`,
  ``,
].join('\n')

const dTag = `newsletter-${issueNumber}`
const template = {
  kind: KINDS.COMPASS_ISSUE,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ['d', dTag],
    ['title', title],
    ['summary', `Seeded Logbook test issue ${issueNumber}`],
    ['published_at', String(Math.floor(Date.now() / 1000))],
  ],
  content,
}

const signed = await createCompassAmberSigner().signEvent(template)

const pool = new SimplePool()
try {
  await Promise.any(pool.publish(RELAYS, signed))
} finally {
  pool.close(RELAYS)
}

const targets = requiredChapterTargets(content, issueNumber)
console.log(`Published ${dTag} as ${signed.id}`)
console.log(`Recording chapters the watcher will create (${targets.length}):`)
for (const target of targets) console.log(`  ${target.id}  ${target.title}`)

process.exit(0)
