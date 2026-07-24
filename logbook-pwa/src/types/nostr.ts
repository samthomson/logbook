import { KINDS } from '../config'

// ─── Base Nostr event shape ───────────────────────────────────────────────────

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

// ─── Segment (kind 4200) ──────────────────────────────────────────────────────

export interface SegmentAudio {
  url: string
  sha256: string
  mime: string
  duration: number
  waveform: number[]
}

export interface SegmentContent {
  audio: SegmentAudio
  isIntro: boolean
}

/** A parsed kind 4200 segment event with decoded fields. */
export interface Segment {
  event: NostrEvent
  audio: SegmentAudio
  isIntro: boolean
  sectionId: string
  issueId: string
  respondingTo: string | null  // event ID, soft pointer only
  alt: string | null
}

// ─── Manifest (kind 34200) ────────────────────────────────────────────────────

export type EpisodeStatus = 'draft' | 'cutting' | 'published'

export interface ManifestSection {
  id: string
  title: string
  introEventId: string | null
  sectionExcluded?: boolean // explicit admin override; never overload introEventId
  order: string[]        // segment event IDs in EDL order
  excluded: string[]     // segment event IDs excluded from cut
  reviewed: string[]     // segment event IDs marked reviewed by admin
}

export interface PublishedRss {
  guid: string
  mp3Url: string
  chapters: PodcastChapter[]
}

export interface PodcastChapter {
  startTime: number      // seconds from episode start
  title: string          // contributor display name + section title
  segmentEventId: string
  contributorPubkey: string
}

export interface ManifestContent {
  issueRef: string       // naddr of kind 30023 Compass issue
  episodeStatus: EpisodeStatus
  sections: ManifestSection[]
  publishedRss: PublishedRss | null
}

/** A parsed kind 34200 manifest event. */
export interface IssueManifest {
  event: NostrEvent
  issueId: string        // from d-tag
  content: ManifestContent
}

// ─── Compass Issue (kind 30023) ───────────────────────────────────────────────

export interface IssueSection {
  id: string             // stable sec-<slug>-<N> format
  title: string          // H2 title
  items: IssueSectionItem[]
}

export interface IssueSectionItem {
  /** Stable per-item id: sec-<h2slug>-<h3slug>-<issueNumber>. Empty for lead prose. */
  id?: string
  title: string          // H3 title
  body: string           // prose under the H3
}

export interface CompassIssue {
  event: NostrEvent
  issueNumber: number
  title: string
  sections: IssueSection[]
}

// ─── Transcript companion (kind 1111 scoped) ─────────────────────────────────

export interface TranscriptEvent {
  event: NostrEvent
  segmentEventId: string
  text: string
}

// ─── Auth / identity ──────────────────────────────────────────────────────────

export type SignFn = (event: Omit<NostrEvent, 'id' | 'sig'>) => Promise<NostrEvent>

export interface NostrSigner {
  getPublicKey(): Promise<string>
  signEvent(event: Omit<NostrEvent, 'id' | 'sig'>): Promise<NostrEvent>
}

// ─── Blossom ──────────────────────────────────────────────────────────────────

export interface BlobDescriptor {
  url: string
  sha256: string
  size: number
  mime: string
  uploaded: number       // unix timestamp
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isSegmentEvent(event: NostrEvent): boolean {
  return event.kind === KINDS.SEGMENT
}

export function isManifestEvent(event: NostrEvent): boolean {
  return event.kind === KINDS.MANIFEST
}

export function parseSegmentContent(raw: string): SegmentContent | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'audio' in parsed &&
      'isIntro' in parsed
    ) {
      return parsed as SegmentContent
    }
    return null
  } catch {
    return null
  }
}

export function parseManifestContent(raw: string): ManifestContent | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'issueRef' in parsed &&
      'episodeStatus' in parsed &&
      'sections' in parsed
    ) {
      return parsed as ManifestContent
    }
    return null
  } catch {
    return null
  }
}

/** Extract a tag value by name from a Nostr event's tags array. */
export function getTag(event: NostrEvent, name: string): string | null {
  const tag = event.tags.find((t) => t[0] === name)
  return tag ? (tag[1] ?? null) : null
}

/** Extract all values for a repeated tag name. */
export function getTags(event: NostrEvent, name: string): string[] {
  return event.tags.filter((t) => t[0] === name).map((t) => t[1] ?? '')
}
