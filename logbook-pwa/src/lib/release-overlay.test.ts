import { describe, expect, it } from 'vitest'
import type { IssueManifest, NostrEvent } from '../types/nostr'
import { overlayReleaseOnCut, withReleaseOverlay } from './release-overlay'

const COMPASS = 'c'.repeat(64)
const PRODUCER = 'p'.repeat(64)

function event(
  id: string,
  created_at: number,
  pubkey: string,
  content: object,
  extraTags: string[][] = [],
): NostrEvent {
  return {
    id,
    created_at,
    pubkey,
    kind: 34200,
    sig: 'b'.repeat(128),
    tags: [['d', 'logbook-31'], ...extraTags],
    content: JSON.stringify({ issueRef: 'naddr1', sections: [{ id: 'news' }], ...content }),
  }
}

function issue(ev: NostrEvent): IssueManifest {
  return {
    event: ev,
    issueId: 'logbook-31',
    content: JSON.parse(ev.content),
  }
}

describe('overlayReleaseOnCut', () => {
  it('keeps a new lock cutting and copies Compass progress that names it', () => {
    const lock = event('lock', 10, PRODUCER, { episodeStatus: 'cutting' })
    const progress = event('progress', 20, COMPASS, {
      episodeStatus: 'cutting',
      release: { completed: ['audio', 'chapters'] },
    }, [['previous', 'lock']])
    const published = event('pub', 5, COMPASS, { episodeStatus: 'published' })
    const overlaid = overlayReleaseOnCut(issue(lock), [lock, progress, published], COMPASS)
    expect(overlaid.episodeStatus).toBe('cutting')
    expect(overlaid.release?.completed).toEqual(['audio', 'chapters'])
  })

  it('copies untagged Compass progress onto a first lock when nothing is published', () => {
    const lock = event('lock', 10, PRODUCER, { episodeStatus: 'cutting' })
    const progress = event('progress', 20, COMPASS, {
      episodeStatus: 'cutting',
      release: { completed: ['audio', 'chapters'] },
    })
    const overlaid = overlayReleaseOnCut(issue(lock), [lock, progress], COMPASS)
    expect(overlaid.release?.completed).toEqual(['audio', 'chapters'])
  })

  it('does not copy an old same-cut progress onto a later lock', () => {
    const published = event('pub', 5, COMPASS, { episodeStatus: 'published' })
    const lock = event('lock-2', 10, PRODUCER, { episodeStatus: 'cutting' }, [['previous', 'pub']])
    const oldProgress = event('old-progress', 20, COMPASS, {
      episodeStatus: 'cutting',
      release: { completed: ['audio', 'chapters', 'feed'] },
    })
    const overlaid = overlayReleaseOnCut(issue(lock), [lock, oldProgress, published], COMPASS)
    expect(overlaid.episodeStatus).toBe('cutting')
    expect(overlaid.release?.completed).toBeUndefined()
  })

  it('shows Compass published when that event names this lock', () => {
    const lock = event('lock', 10, PRODUCER, { episodeStatus: 'cutting' })
    const published = event('pub', 5, COMPASS, { episodeStatus: 'published' }, [['previous', 'lock']])
    const overlaid = overlayReleaseOnCut(issue(lock), [lock, published], COMPASS)
    expect(overlaid.episodeStatus).toBe('published')
  })

  it('shows Compass published when that event names progress of this lock', () => {
    const lock = event('lock', 10, PRODUCER, { episodeStatus: 'cutting' })
    const progress = event('progress', 20, COMPASS, {
      episodeStatus: 'cutting',
      release: { completed: ['audio', 'chapters'] },
    }, [['previous', 'lock']])
    const published = event('pub', 30, COMPASS, { episodeStatus: 'published' }, [['previous', 'progress']])
    const overlaid = overlayReleaseOnCut(issue(lock), [lock, progress, published], COMPASS)
    expect(overlaid.episodeStatus).toBe('published')
    expect(withReleaseOverlay(issue(lock), [lock, progress, published], COMPASS).event.id).toBe('pub')
  })
})
