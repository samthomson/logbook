import { COMPASS_PUBKEY, D_PODSTR, KINDS, RELAYS } from '../config'
import { getPool } from './pool'
import { filterVerified } from './relay'
import type { NostrEvent } from '../types/nostr'

function newest(events: NostrEvent[]): NostrEvent | null {
  const verified = filterVerified(events)
    .filter((event) => event.pubkey === COMPASS_PUBKEY)
    .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))
  return verified[0] ?? null
}

/** Kind 1 Compass announcement for this episode's audio URL. */
export async function fetchAnnouncementEvent(
  mp3Url: string,
  storedId?: string | null,
): Promise<NostrEvent | null> {
  if (storedId) {
    const byId = await getPool().querySync(RELAYS, { ids: [storedId], limit: 1 }, { maxWait: 1_800 })
    const match = newest(byId as NostrEvent[])
    if (match) return match
  }
  const tagged = await getPool().querySync(RELAYS, {
    kinds: [1],
    authors: [COMPASS_PUBKEY],
    '#r': [mp3Url],
    limit: 20,
  }, { maxWait: 1_800 })
  return newest(tagged as NostrEvent[])
}

/** Kind 30054 podstr episode for this Logbook issue. */
export async function fetchPodstrEpisode(issueNumber: number): Promise<NostrEvent | null> {
  const events = await getPool().querySync(RELAYS, {
    kinds: [KINDS.PODSTR_EPISODE],
    authors: [COMPASS_PUBKEY],
    '#d': [D_PODSTR(issueNumber)],
    limit: 5,
  }, { maxWait: 1_800 })
  return newest(events as NostrEvent[])
}
