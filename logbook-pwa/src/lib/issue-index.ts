import { extractIssueNumber } from './compass'
import type { EpisodeStatus, NostrEvent } from '../types/nostr'

const COMPASS_NEWSLETTER_FEED = 'https://nostrcompass.org/en/newsletters/feed.xml'
const ITEM_RE = /<item>([\s\S]*?)<\/item>/g
const TITLE_RE = /<title>\s*Nostr Compass #(\d+)\s*<\/title>/i
const LINK_RE = /<link>(https:\/\/nostrcompass\.org\/en\/newsletters\/\d{4}-\d{2}-\d{2}-newsletter\/)<\/link>/

/** Newsletters before this unix second cannot start a new Logbook episode. */
export const LOGBOOK_FROM_SECONDS = Math.floor(Date.UTC(2026, 7, 1) / 1000)

const NEWSLETTER_D_TAG = /^newsletter-(\d{1,9})$/

export type IndexState = 'archive' | 'none' | 'draft' | 'cutting' | 'published'

export interface IndexRow {
  state: IndexState
  label: string
  canOpenEpisode: boolean
  episodeDisabled: boolean
  canStartDraft: boolean
}

export function newsletterIdentifier(event: NostrEvent): string | null {
  const value = event.tags.find((tag) => tag[0] === 'd')?.[1]
  return value && value.length > 0 ? value : null
}

/** Kind 30023 d-tag the episode page can actually load. */
export function isNewsletterAddress(event: NostrEvent): boolean {
  const identifier = newsletterIdentifier(event)
  return Boolean(identifier && NEWSLETTER_D_TAG.test(identifier))
}

/** Eligible to start a Logbook draft: newsletter-N on or after 1 Aug 2026. */
export function isLogbookNewsletter(event: NostrEvent): boolean {
  return isNewsletterAddress(event) && event.created_at >= LOGBOOK_FROM_SECONDS
}

/** Compass RSS maps `Nostr Compass #N` to the Hugo permalink. Events do not. */
export function parseCompassNewsletterLinks(xml: string): Map<number, string> {
  const links = new Map<number, string>()
  for (const item of xml.matchAll(ITEM_RE)) {
    const block = item[1]
    const number = Number(block.match(TITLE_RE)?.[1])
    const href = block.match(LINK_RE)?.[1]
    if (Number.isInteger(number) && number > 0 && href) links.set(number, href)
  }
  return links
}

export function compassArticleUrl(
  event: NostrEvent,
  links: ReadonlyMap<number, string>,
): string | null {
  const number = extractIssueNumber(event)
  return number > 0 ? links.get(number) ?? null : null
}

export async function fetchCompassNewsletterLinks(): Promise<Map<number, string>> {
  const response = await fetch(COMPASS_NEWSLETTER_FEED)
  if (!response.ok) {
    throw new Error(`Compass newsletter feed returned ${response.status}`)
  }
  return parseCompassNewsletterLinks(await response.text())
}

export function indexRow(
  event: NostrEvent,
  status: EpisodeStatus | undefined,
  opts: { showUnpublished: boolean; producer: boolean },
): IndexRow {
  const addressable = isNewsletterAddress(event)
  if (addressable && status === 'published') {
    return { state: 'published', label: 'Published', canOpenEpisode: true, episodeDisabled: false, canStartDraft: false }
  }
  if (addressable && (status === 'draft' || status === 'cutting')) {
    return {
      state: status,
      label: status === 'cutting' ? 'Making the audio' : 'Recording',
      canOpenEpisode: opts.showUnpublished,
      episodeDisabled: !opts.showUnpublished,
      canStartDraft: false,
    }
  }
  if (isLogbookNewsletter(event)) {
    return {
      state: 'none',
      label: 'No episode',
      canOpenEpisode: false,
      episodeDisabled: true,
      canStartDraft: opts.producer,
    }
  }
  return {
    state: 'archive',
    label: 'Compass article',
    canOpenEpisode: false,
    episodeDisabled: true,
    canStartDraft: false,
  }
}
