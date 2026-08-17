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
const title = titleIndex >= 0 ? args[titleIndex + 1] : `Nostr Compass #${issueNumber}`
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

// Same heading grammar as a real Compass issue (NIP-23 markdown): a lede,
// then ## sections with ### items and a paragraph of prose under each.
// H2 lead prose must be non-empty or that group is not a recording chapter.
const content = [
  `Amethyst shipped calendars and on-chain zap splits. White Noise got iOS push.`,
  `Relays and blossom servers had a quieter week. Clients kept moving.`,
  ``,
  `## Top stories`,
  `The releases that opened the week.`,
  ``,
  `### Amethyst v1.11.0`,
  `Calendars landed as their own timeline, not jammed into long-form. On-chain zap splits now match Lightning splits. Group replies in Marmot threads use the same parent UI as public notes.`,
  ``,
  `### White Noise iOS push`,
  `A Notification Service Extension decrypts MLS messages on the phone so iPhone users see traffic without leaving the app open. Block/unblock and add-members finally have buttons.`,
  ``,
  `## Relays`,
  `What operators actually changed.`,
  ``,
  `### Citrine per-relay subscriptions`,
  `Citrine stopped sharing one global filter across every upstream, so two relays with kinds:[1] no longer collide in the aggregator. Onion URLs stay off the clearnet path when Tor is off.`,
  ``,
  `## Clients`,
  `Everything else worth a voice note.`,
  ``,
  `### Vector v0.4.0`,
  `vector-core is one crate for desktop and Android. NIP-46 bunker login, one-click Tor, and MLS group sync over negentropy. An MCP server exposes twenty-one tools so an agent can drive the messenger.`,
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
