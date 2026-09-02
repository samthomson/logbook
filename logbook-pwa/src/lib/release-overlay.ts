import { COMPASS_PUBKEY } from '../config'
import type { IssueManifest, ManifestContent, NostrEvent } from '../types/nostr'
import { parseManifestContent } from '../types/nostr'
import { cutBodyKey, selectNewestManifestRevision } from './manifest-revision'

function previousIds(event: { tags?: string[][] }): string[] {
  return (event.tags ?? [])
    .filter((tag) => tag[0] === 'previous' && typeof tag[1] === 'string' && tag[1].length > 0)
    .map((tag) => tag[1])
}

function statusOf(content: string): string | null {
  return parseManifestContent(content)?.episodeStatus ?? null
}

function relatedToLock(lockId: string, all: readonly NostrEvent[]): Set<string> {
  const related = new Set([lockId])
  let grew = true
  while (grew) {
    grew = false
    for (const event of all) {
      if (related.has(event.id)) continue
      if (!previousIds(event).some((id) => related.has(id))) continue
      related.add(event.id)
      grew = true
    }
  }
  return related
}

function overlayFromProgress(cut: ManifestContent, progress: NostrEvent | null): ManifestContent {
  if (!progress) return cut
  const parsed = parseManifestContent(progress.content)
  if (!parsed) return cut
  return {
    ...cut,
    release: parsed.release,
    lastFailure: parsed.lastFailure,
    publishedRss: parsed.publishedRss ?? cut.publishedRss,
  }
}

/**
 * The cut and Compass release progress are different events. The page shows the
 * selected cut, then overlays Compass progress / a published event that released
 * that exact lock. One kind 34200 is never asked to be both.
 */
export function overlayReleaseOnCut(
  selected: IssueManifest,
  all: readonly NostrEvent[],
  compassPubkey = COMPASS_PUBKEY,
): ManifestContent {
  const cut = selected.content
  if (cut.episodeStatus !== 'cutting') return cut
  const compass = compassPubkey.toLowerCase()
  const compassEvents = all.filter((event) => event.pubkey.toLowerCase() === compass)
  const published = selectNewestManifestRevision(
    compassEvents.filter((event) => statusOf(event.content) === 'published'),
  )
  const related = relatedToLock(selected.event.id, all)
  if (published && previousIds(published).some((id) => related.has(id))) {
    return parseManifestContent(published.content) ?? cut
  }
  const compassCutting = (event: NostrEvent) => (
    event.pubkey.toLowerCase() === compass && statusOf(event.content) === 'cutting'
  )
  const tagged = selectNewestManifestRevision(
    all.filter((event) => compassCutting(event) && related.has(event.id) && event.id !== selected.event.id),
  )
  if (tagged) return overlayFromProgress(cut, tagged)
  // Untagged progress from this first lock (copied the lock's tags, no previous=lock).
  if (published) return cut
  const body = cutBodyKey(selected.event.content)
  return overlayFromProgress(cut, selectNewestManifestRevision(
    compassEvents.filter((event) => (
      compassCutting(event)
      && event.id !== selected.event.id
      && (!body || cutBodyKey(event.content) === body)
    )),
  ))
}

export function withReleaseOverlay(
  selected: IssueManifest,
  all: readonly NostrEvent[],
  compassPubkey = COMPASS_PUBKEY,
): IssueManifest {
  const content = overlayReleaseOnCut(selected, all, compassPubkey)
  if (content.episodeStatus !== 'published') return { ...selected, content }
  const compass = compassPubkey.toLowerCase()
  const published = selectNewestManifestRevision(
    all.filter((event) => (
      event.pubkey.toLowerCase() === compass && statusOf(event.content) === 'published'
    )),
  )
  const related = relatedToLock(selected.event.id, all)
  if (published && previousIds(published).some((id) => related.has(id))) {
    return { event: published, issueId: selected.issueId, content }
  }
  return { ...selected, content }
}

export function releaseOverlayKey(manifest: IssueManifest): string {
  const release = manifest.content.release
  const failure = manifest.content.lastFailure
  return [
    manifest.event.id,
    manifest.content.episodeStatus,
    JSON.stringify(release?.completed ?? []),
    release?.failed ?? '',
    failure?.at ?? '',
    failure?.stage ?? '',
  ].join(':')
}
