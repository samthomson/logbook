import { describe, expect, it } from 'vitest'
import type { IssueManifest, ManifestContent, NostrEvent } from '../types/nostr'
import { pageCut } from './use-episode-cut'

function content(status: ManifestContent['episodeStatus'], extra: Partial<ManifestContent> = {}): ManifestContent {
  return {
    issueRef: 'naddr1',
    episodeStatus: status,
    sections: [],
    publishedRss: null,
    ...extra,
  }
}

function manifest(status: ManifestContent['episodeStatus'], extra: Partial<ManifestContent> = {}): IssueManifest {
  const body = content(status, extra)
  const event: NostrEvent = {
    id: '1'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 1,
    kind: 34200,
    tags: [['d', 'logbook-34']],
    content: JSON.stringify(body),
    sig: 'b'.repeat(128),
  }
  return { event, issueId: 'logbook-34', content: body }
}

describe('pageCut', () => {
  it('shows the signed overlay while the cut is locked, not a stale editor copy', () => {
    const draft = content('cutting', { release: { completed: ['audio', 'chapters'] } })
    const base = manifest('published', { release: { completed: ['audio', 'chapters', 'feed', 'podstr', 'announcement'] } })
    expect(pageCut(false, draft, base)?.episodeStatus).toBe('published')
  })

  it('keeps the editor copy while the cut is open', () => {
    const draft = content('draft')
    const base = manifest('draft')
    expect(pageCut(true, draft, base)).toBe(draft)
  })
})
