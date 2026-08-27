import { describe, expect, it } from 'vitest'
import type { ManifestContent, NostrEvent } from '../types/nostr'
import { reachableHref, releaseChecklist, type ChecklistInput } from './release-checklist'

function manifest(overrides: Partial<ManifestContent> = {}): ManifestContent {
  return {
    issueRef: 'naddr1qa',
    episodeStatus: 'draft',
    sections: [],
    publishedRss: null,
    ...overrides,
  }
}

const lockEvent: NostrEvent = {
  id: 'a'.repeat(64),
  pubkey: 'b'.repeat(64),
  created_at: 1,
  kind: 34200,
  tags: [['d', 'logbook-32']],
  content: '{}',
  sig: 'c'.repeat(128),
}

function rows(input: Partial<ChecklistInput> = {}) {
  return releaseChecklist({
    content: manifest(),
    manifestEvent: lockEvent,
    publishReady: true,
    waitingReason: 'Running order saved.',
    saving: false,
    ...input,
  })
}

describe('releaseChecklist', () => {
  it('offers Publish episode on a ready draft and leaves later steps waiting', () => {
    const listed = rows()
    expect(listed[0]).toMatchObject({
      id: 'lock',
      state: 'ready',
      action: 'lock',
      primary: true,
      label: 'The cut is not locked',
    })
    expect(listed[0].inspect).toBeUndefined()
    expect(listed.slice(1).every((row) => row.state === 'waiting' && !row.primary)).toBe(true)
  })

  it('marks audio failed after a stitch hand-back and keeps lock as the retry', () => {
    const listed = rows({
      content: manifest({
        lastFailure: { at: 1, reason: 'A voice note recorded no sound.', segmentId: 'seg-1' },
      }),
    })
    expect(listed[0]).toMatchObject({ id: 'lock', state: 'ready', action: 'lock', primary: true })
    expect(listed[1]).toMatchObject({
      id: 'audio',
      state: 'failed',
      detail: 'A voice note recorded no sound.',
      scrollToSegmentId: 'seg-1',
    })
    expect(listed[1].action).toBeUndefined()
  })

  it('shows the worker on the first incomplete step while cutting', () => {
    const listed = rows({
      content: manifest({
        episodeStatus: 'cutting',
        release: { completed: ['audio'] },
        publishedRss: { mp3Url: 'https://blossom.test/ep.mp3' },
      }),
      publishReady: false,
      waitingReason: '',
    })
    expect(listed[0]).toMatchObject({
      id: 'lock',
      state: 'locked',
      action: undefined,
      inspect: 'lock',
      detail: 'The worker is making the episode.',
    })
    expect(listed[1]).toMatchObject({
      id: 'audio',
      state: 'done',
      href: 'https://blossom.test/ep.mp3',
      label: 'Episode audio is on Blossom',
    })
    expect(listed[2]).toMatchObject({
      id: 'chapters',
      state: 'happening',
      label: 'Chapters file is being made',
      detail: '',
    })
    expect(listed[3]).toMatchObject({
      id: 'feed',
      state: 'queued',
      label: 'RSS feed is queued',
      detail: '',
    })
    expect(listed[listed.length - 1]).toMatchObject({
      id: 'published',
      state: 'queued',
      label: 'This episode is queued',
    })
    expect(listed.some((row) => row.primary)).toBe(false)
  })

  it('puts Try again on a failed RSS step and keeps finished audio done', () => {
    const listed = rows({
      content: manifest({
        episodeStatus: 'cutting',
        release: { completed: ['audio', 'chapters'], failed: 'feed' },
        lastFailure: { at: 2, reason: 'Blossom rejected the feed.', stage: 'feed' },
        publishedRss: { mp3Url: 'https://blossom.test/ep.mp3', chaptersUrl: 'https://blossom.test/ch.json' },
      }),
      publishReady: false,
      waitingReason: '',
    })
    expect(listed[0]).toMatchObject({ id: 'lock', state: 'locked', detail: '' })
    expect(listed[3]).toMatchObject({
      id: 'feed',
      state: 'failed',
      action: 'retry',
      primary: true,
      detail: 'Blossom rejected the feed.',
    })
    expect(listed[1].state).toBe('done')
    expect(listed[2].state).toBe('done')
    expect(listed[4]).toMatchObject({ id: 'podstr', state: 'queued' })
  })

  it('treats a lastFailure on an already-done step as the next unfinished one', () => {
    const listed = rows({
      content: manifest({
        episodeStatus: 'cutting',
        release: { completed: ['audio', 'chapters'], failed: 'chapters' },
        lastFailure: { at: 3, reason: 'Amber signing failed (signal):', stage: 'chapters' },
        publishedRss: { mp3Url: 'https://blossom.test/ep.mp3', chaptersUrl: 'https://blossom.test/ch.json' },
      }),
      publishReady: false,
      waitingReason: '',
    })
    expect(listed[2].state).toBe('done')
    expect(listed[3]).toMatchObject({
      id: 'feed',
      state: 'failed',
      action: 'retry',
      primary: true,
    })
  })

  it('marks every step done once published, with in-app inspect and hosted URLs', () => {
    const note = { ...lockEvent, id: 'd'.repeat(64), kind: 1, tags: [] }
    const listing = { ...lockEvent, id: 'e'.repeat(64), kind: 30054, tags: [['d', 'logbook-logbook-32']] }
    const listed = rows({
      content: manifest({
        episodeStatus: 'published',
        release: { completed: ['audio', 'chapters', 'feed', 'podstr', 'announcement'] },
        publishedRss: {
          mp3Url: 'https://blossom.test/ep.mp3',
          chaptersUrl: 'https://blossom.test/ch.json',
          feedUrl: 'https://blossom.test/feed.xml',
        },
      }),
      podstrEvent: listing,
      announcementEvent: note,
      publishReady: false,
      waitingReason: '',
    })
    expect(listed.every((row) => row.state === 'done')).toBe(true)
    expect(listed.find((row) => row.id === 'lock')?.inspect).toBe('lock')
    expect(listed.find((row) => row.id === 'audio')?.href).toBe('https://blossom.test/ep.mp3')
    expect(listed.find((row) => row.id === 'chapters')?.chaptersUrl).toBe('https://blossom.test/ch.json')
    expect(listed.find((row) => row.id === 'chapters')?.href).toBeUndefined()
    expect(listed.find((row) => row.id === 'feed')?.href).toBe('https://blossom.test/feed.xml')
    expect(listed.find((row) => row.id === 'podstr')?.inspect).toBe('podstr')
    expect(listed.find((row) => row.id === 'announcement')?.inspect).toBe('announcement')
    expect(listed.find((row) => row.id === 'published')?.href).toBeUndefined()
    expect(listed.some((row) => row.action || row.primary)).toBe(false)
  })

  it('offers an https or local origin feed', () => {
    expect(reachableHref('http://localhost:8080/feed.xml')).toBe('http://localhost:8080/feed.xml')
    expect(reachableHref('https://blossom.test/feed.xml')).toBe('https://blossom.test/feed.xml')
    expect(reachableHref('javascript:alert(1)')).toBeUndefined()
  })
})
