import { describe, expect, it } from 'vitest'
import type { ManifestContent } from '../types/nostr'
import { releaseChecklist } from './release-checklist'

function manifest(overrides: Partial<ManifestContent> = {}): ManifestContent {
  return {
    issueRef: 'naddr1qa',
    episodeStatus: 'draft',
    sections: [],
    publishedRss: null,
    ...overrides,
  }
}

describe('releaseChecklist', () => {
  it('offers Publish episode on a ready draft and leaves later steps waiting', () => {
    const rows = releaseChecklist({
      content: manifest(),
      publishReady: true,
      waitingReason: 'Running order saved.',
      saving: false,
    })
    expect(rows[0]).toMatchObject({
      id: 'lock',
      state: 'ready',
      action: 'lock',
      primary: true,
      label: 'The cut is not locked',
    })
    expect(rows.slice(1).every((row) => row.state === 'waiting' && !row.primary)).toBe(true)
  })

  it('marks audio failed after a stitch hand-back and keeps lock as the retry', () => {
    const rows = releaseChecklist({
      content: manifest({
        lastFailure: { at: 1, reason: 'A voice note recorded no sound.', segmentId: 'seg-1' },
      }),
      publishReady: true,
      waitingReason: '',
      saving: false,
    })
    expect(rows[0]).toMatchObject({ id: 'lock', state: 'ready', action: 'lock', primary: true })
    expect(rows[1]).toMatchObject({
      id: 'audio',
      state: 'failed',
      detail: 'A voice note recorded no sound.',
      scrollToSegmentId: 'seg-1',
    })
    expect(rows[1].action).toBeUndefined()
  })

  it('shows the worker on the first incomplete step while cutting', () => {
    const rows = releaseChecklist({
      content: manifest({
        episodeStatus: 'cutting',
        release: { completed: ['audio'] },
        publishedRss: { mp3Url: 'https://blossom.test/ep.mp3' },
      }),
      publishReady: false,
      waitingReason: '',
      saving: false,
    })
    expect(rows[0]).toMatchObject({ id: 'lock', state: 'done', action: undefined })
    expect(rows[1]).toMatchObject({
      id: 'audio',
      state: 'done',
      href: 'https://blossom.test/ep.mp3',
    })
    expect(rows[2]).toMatchObject({
      id: 'chapters',
      state: 'happening',
      label: 'Chapters file is being made',
      detail: '',
    })
    expect(rows[1]).toMatchObject({ id: 'audio', label: 'Episode audio is on Blossom' })
    expect(rows.some((row) => row.primary)).toBe(false)
  })

  it('puts Try again on a failed RSS step and keeps finished audio done', () => {
    const rows = releaseChecklist({
      content: manifest({
        episodeStatus: 'cutting',
        release: { completed: ['audio', 'chapters'], failed: 'feed' },
        lastFailure: { at: 2, reason: 'Blossom rejected the feed.', stage: 'feed' },
        publishedRss: { mp3Url: 'https://blossom.test/ep.mp3', chaptersUrl: 'https://blossom.test/ch.json' },
      }),
      publishReady: false,
      waitingReason: '',
      saving: false,
    })
    expect(rows[3]).toMatchObject({
      id: 'feed',
      state: 'failed',
      action: 'retry',
      primary: true,
      detail: 'Blossom rejected the feed.',
    })
    expect(rows[1].state).toBe('done')
    expect(rows[2].state).toBe('done')
  })

  it('marks every step done once published, with open links where URLs exist', () => {
    const rows = releaseChecklist({
      content: manifest({
        episodeStatus: 'published',
        release: { completed: ['audio', 'chapters', 'feed', 'podstr', 'announcement'] },
        publishedRss: {
          mp3Url: 'https://blossom.test/ep.mp3',
          chaptersUrl: 'https://blossom.test/ch.json',
          feedUrl: 'https://logbook.test/feed.xml',
        },
      }),
      publishReady: false,
      waitingReason: '',
      saving: false,
    })
    expect(rows.every((row) => row.state === 'done')).toBe(true)
    expect(rows.find((row) => row.id === 'feed')?.href).toBe('https://logbook.test/feed.xml')
    expect(rows.some((row) => row.action || row.primary)).toBe(false)
  })
})
