import type { NostrEvent } from '../types/nostr'
import { parseManifestContent } from '../types/nostr'

/** Event with JSON `content` expanded so stringify is readable, not one escaped line. */
export function inspectableEvent(event: NostrEvent): Record<string, unknown> {
  try {
    return { ...event, content: JSON.parse(event.content) as unknown }
  } catch {
    return { ...event }
  }
}

export function formatEventJson(event: NostrEvent): string {
  return JSON.stringify(inspectableEvent(event), null, 2)
}

export interface CutChapterView {
  title: string
  inCut: string[]
  leftOut: string[]
}

export interface CutView {
  status: string
  chapters: CutChapterView[]
}

/** Chapters and recording ids from a kind 34200 cut. */
export function cutView(event: NostrEvent): CutView | null {
  const content = parseManifestContent(event.content)
  if (!content) return null
  return {
    status: content.episodeStatus,
    chapters: content.sections.map((section) => {
      const excluded = new Set(section.excluded)
      return {
        title: section.title,
        inCut: section.order.filter((id) => !excluded.has(id)),
        leftOut: section.excluded,
      }
    }),
  }
}
