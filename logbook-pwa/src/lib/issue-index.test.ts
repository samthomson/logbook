import { describe, expect, it } from 'vitest'
import type { NostrEvent } from '../types/nostr'
import {
  compassArticleUrl,
  indexRow,
  isLogbookNewsletter,
  LOGBOOK_FROM_SECONDS,
  parseCompassNewsletterLinks,
} from './issue-index'

function event(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '1'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: LOGBOOK_FROM_SECONDS + 86_400,
    kind: 30_023,
    tags: [['d', 'newsletter-34'], ['title', 'Nostr Compass #34']],
    content: 'body',
    sig: 'b'.repeat(128),
    ...overrides,
  }
}

const FEED = `<?xml version="1.0"?>
<rss><channel>
<item>
  <title>Nostr Compass #36</title>
  <link>https://nostrcompass.org/en/newsletters/2026-08-19-newsletter/</link>
</item>
<item>
  <title>Nostr Compass #34</title>
  <link>https://nostrcompass.org/en/newsletters/2026-08-05-newsletter/</link>
</item>
<item>
  <title>Nostr Compass #23</title>
  <link>https://nostrcompass.org/en/newsletters/2026-05-21-newsletter/</link>
</item>
<item>
  <title>Nostr Compass #12</title>
  <link>https://nostrcompass.org/en/newsletters/2026-03-04-newsletter/</link>
</item>
</channel></rss>`

describe('isLogbookNewsletter', () => {
  it('accepts a newsletter-N issue on or after 1 Aug 2026', () => {
    expect(isLogbookNewsletter(event({ created_at: LOGBOOK_FROM_SECONDS }))).toBe(true)
  })

  it('rejects a random legacy d-tag even when the title has a number', () => {
    expect(isLogbookNewsletter(event({
      created_at: LOGBOOK_FROM_SECONDS + 1,
      tags: [['d', 'aad064a0b1982a80'], ['title', 'Nostr Compass #1']],
    }))).toBe(false)
  })

  it('rejects newsletter-N from before the cutoff as a new draft', () => {
    expect(isLogbookNewsletter(event({ created_at: LOGBOOK_FROM_SECONDS - 1 }))).toBe(false)
  })
})

describe('compassArticleUrl', () => {
  const links = parseCompassNewsletterLinks(FEED)

  it('joins the event issue number to the Compass permalink, not the Nostr day', () => {
    expect(compassArticleUrl(event({
      created_at: 1_772_627_058,
      tags: [['d', '76fa9c6ade9c73f6'], ['title', 'Nostr Compass #12'], ['published_at', '1772627058']],
    }), links)).toBe('https://nostrcompass.org/en/newsletters/2026-03-04-newsletter/')
  })

  it('maps #23 (20 May on the relay) to the 21 May Compass page', () => {
    expect(compassArticleUrl(event({
      created_at: 1_779_294_147,
      tags: [['d', 'newsletter-23'], ['title', 'Nostr Compass #23'], ['published_at', '1779294147']],
    }), links)).toBe('https://nostrcompass.org/en/newsletters/2026-05-21-newsletter/')
  })

  it('maps a Thursday Nostr publish to the Wednesday Compass page', () => {
    expect(compassArticleUrl(event({
      tags: [['d', 'newsletter-34'], ['title', 'Nostr Compass #34'], ['published_at', '1786030491']],
    }), links)).toBe('https://nostrcompass.org/en/newsletters/2026-08-05-newsletter/')
  })

  it('omits a link when Compass has no matching issue number', () => {
    expect(compassArticleUrl(event({
      tags: [['d', 'newsletter-99'], ['title', 'Nostr Compass #99']],
    }), links)).toBeNull()
  })
})

describe('indexRow', () => {
  it('still opens a recording already in progress before the cutoff', () => {
    const row = indexRow(
      event({ created_at: LOGBOOK_FROM_SECONDS - 1 }),
      'draft',
      { showUnpublished: true, producer: true },
    )
    expect(row).toMatchObject({
      state: 'draft',
      label: 'Recording',
      canOpenEpisode: true,
      episodeDisabled: false,
      canStartDraft: false,
    })
  })

  it('does not start a new episode on a pre-cutoff newsletter with no cut', () => {
    const row = indexRow(
      event({ created_at: LOGBOOK_FROM_SECONDS - 1 }),
      undefined,
      { showUnpublished: true, producer: true },
    )
    expect(row).toMatchObject({ state: 'archive', canOpenEpisode: false, episodeDisabled: true, canStartDraft: false })
  })

  it('lets a producer start a draft when there is no episode yet', () => {
    const row = indexRow(event(), undefined, { showUnpublished: true, producer: true })
    expect(row).toMatchObject({ state: 'none', label: 'No episode', canStartDraft: true, canOpenEpisode: false, episodeDisabled: true })
  })

  it('opens a published episode for everyone and hides in-progress from signed-out visitors', () => {
    expect(indexRow(event(), 'published', { showUnpublished: false, producer: false }).canOpenEpisode).toBe(true)
    expect(indexRow(event(), 'draft', { showUnpublished: false, producer: false })).toMatchObject({
      canOpenEpisode: false,
      episodeDisabled: true,
    })
    expect(indexRow(event(), 'draft', { showUnpublished: true, producer: false }).canOpenEpisode).toBe(true)
  })
})
