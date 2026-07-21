import { SimplePool } from 'nostr-tools/pool'
import { COMPASS_PUBKEY, DEFAULT_RELAYS, KINDS } from '../config'
import type { NostrEvent, CompassIssue, IssueSection, IssueSectionItem } from '../types/nostr'
import { slugify } from './utils'

let _pool: SimplePool | null = null

function getPool(): SimplePool {
  if (!_pool) _pool = new SimplePool()
  return _pool
}

/** Fetch the most recent Compass kind 30023 long-form issue. */
export async function fetchLatestIssue(
  relays: string[] = DEFAULT_RELAYS,
): Promise<NostrEvent | null> {
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [COMPASS_PUBKEY],
    limit: 1,
  })
  if (!events.length) return null
  // Return most recent by created_at
  return events.reduce((a, b) => (a.created_at > b.created_at ? a : b))
}

/** Fetch a specific Compass issue by its d-tag (issue number slug). */
export async function fetchIssueByDTag(
  dTag: string,
  relays: string[] = DEFAULT_RELAYS,
): Promise<NostrEvent | null> {
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [COMPASS_PUBKEY],
    '#d': [dTag],
    limit: 1,
  })
  return events[0] ?? null
}

/** Fetch all available Compass issues (for the issue picker). */
export async function fetchAllIssues(
  relays: string[] = DEFAULT_RELAYS,
): Promise<NostrEvent[]> {
  const pool = getPool()
  const events = await pool.querySync(relays, {
    kinds: [KINDS.COMPASS_ISSUE],
    authors: [COMPASS_PUBKEY],
    limit: 50,
  })
  return events.sort((a, b) => b.created_at - a.created_at)
}

/**
 * Extract the issue number from a kind 30023 event.
 * Looks for the "d" tag first (e.g. "31"), then falls back to parsing the title.
 */
export function extractIssueNumber(event: NostrEvent): number {
  const dTag = event.tags.find((t) => t[0] === 'd')?.[1]
  if (dTag) {
    // Handle both plain integer ("31") and prefixed ("logbook-31") d-tags
    const plain = parseInt(dTag, 10)
    if (!isNaN(plain)) return plain
    const prefixed = dTag.match(/(\d+)$/)
    if (prefixed) return parseInt(prefixed[1], 10)
  }
  // Fallback: parse from title tag
  const titleTag = event.tags.find((t) => t[0] === 'title')?.[1] ?? ''
  const match = titleTag.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

/**
 * Parse a Compass kind 30023 event into structured sections.
 *
 * The newsletter uses:
 *   ## Section Title        ← H2 = top-level section
 *   ### Project Name        ← H3 = sub-item within section
 *   prose...
 *
 * Section IDs use the format: sec-<slug>-<issueNumber>
 */
export function parseIssue(event: NostrEvent): CompassIssue {
  const issueNumber = extractIssueNumber(event)
  const titleTag = event.tags.find((t) => t[0] === 'title')?.[1] ?? `Issue ${issueNumber}`
  const sections = parseMarkdownSections(event.content, issueNumber)

  return {
    event,
    issueNumber,
    title: titleTag,
    sections,
  }
}

function parseMarkdownSections(markdown: string, issueNumber: number): IssueSection[] {
  const lines = markdown.split('\n')
  const sections: IssueSection[] = []
  let currentSection: IssueSection | null = null
  let currentItem: IssueSectionItem | null = null
  let currentBody: string[] = []

  const flushItem = () => {
    if (currentItem && currentSection) {
      currentItem.body = currentBody.join('\n').trim()
      currentSection.items.push(currentItem)
      currentItem = null
      currentBody = []
    }
  }

  const flushSection = () => {
    flushItem()
    if (currentSection) {
      sections.push(currentSection)
      currentSection = null
    }
  }

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushSection()
      const title = line.slice(3).trim()
      const id = `sec-${slugify(title)}-${issueNumber}`
      currentSection = { id, title, items: [] }
    } else if (line.startsWith('### ')) {
      flushItem()
      if (currentSection) {
        const title = line.slice(4).trim()
        currentItem = { title, body: '' }
        currentBody = []
      }
    } else {
      if (currentItem) {
        currentBody.push(line)
      } else if (currentSection) {
        // Lead prose directly under the H2, before any H3 — keep it as a
        // title-less item so the excerpt view can render it.
        const last = currentSection.items[currentSection.items.length - 1]
        if (last && !last.title) {
          last.body = `${last.body}\n${line}`.trim()
        } else {
          currentSection.items.push({ title: '', body: line })
        }
      }
    }
  }

  flushSection()
  return sections
}
