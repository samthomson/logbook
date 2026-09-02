import { describe, expect, it, vi } from 'vitest'
import { COMPASS_PUBKEY, KINDS } from '../config'
import type { IssueManifest, ManifestContent, NostrEvent, NostrSigner } from '../types/nostr'
import { startPodcastDraft } from './start-podcast-draft'
import { LOGBOOK_FROM_SECONDS } from './issue-index'

const SAVED_ID = '2'.repeat(64)

function newsletter(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: '1'.repeat(64),
    pubkey: COMPASS_PUBKEY,
    created_at: LOGBOOK_FROM_SECONDS + 86_400,
    kind: KINDS.COMPASS_ISSUE,
    tags: [['d', 'newsletter-42'], ['title', 'Compass #42']],
    content: '## Lead stories\n### Public chapter\nBody',
    sig: '3'.repeat(128),
    ...overrides,
  }
}

function signer(pubkey = 'a'.repeat(64)): NostrSigner {
  return {
    getPublicKey: async () => pubkey,
    signEvent: async (unsigned) => ({
      ...unsigned,
      id: SAVED_ID,
      sig: '4'.repeat(128),
    }),
  }
}

function savedManifest(content: ManifestContent): IssueManifest {
  return {
    issueId: 'logbook-42',
    content,
    event: {
      id: SAVED_ID,
      pubkey: 'a'.repeat(64),
      created_at: 2,
      kind: KINDS.MANIFEST,
      tags: [['d', 'logbook-42']],
      content: JSON.stringify(content),
      sig: '4'.repeat(128),
    },
  }
}

describe('startPodcastDraft', () => {
  it('publishes a draft manifest from the newsletter chapters when none exists', async () => {
    const publish = vi.fn(async (content: ManifestContent) => savedManifest(content).event)
    const fetchLatest = vi.fn()
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(async () => savedManifest(publish.mock.calls[0][0] as ManifestContent))
      .mockImplementationOnce(async () => savedManifest(publish.mock.calls[0][0] as ManifestContent))

    const result = await startPodcastDraft({
      issueEvent: newsletter(),
      signer: signer(),
      expectedPubkey: 'a'.repeat(64),
      save: { fetchLatest, publish, delay: vi.fn() },
    })

    expect(publish).toHaveBeenCalledOnce()
    const content = publish.mock.calls[0][0] as ManifestContent
    expect(content.episodeStatus).toBe('draft')
    expect(content.sections.map((section) => section.id)).toEqual([
      'sec-intro-42',
      'sec-lead-stories-public-chapter-42',
    ])
    expect(content.sections[0].order).toEqual([])
    expect(result.event.id).toBe(SAVED_ID)
  })

  it('refuses a pubkey that is not Compass', async () => {
    await expect(startPodcastDraft({
      issueEvent: newsletter({ pubkey: 'c'.repeat(64) }),
      signer: signer(),
      expectedPubkey: 'a'.repeat(64),
      save: { fetchLatest: vi.fn(), publish: vi.fn(), delay: vi.fn() },
    })).rejects.toThrow(/Compass newsletter/)
  })

  it('refuses a newsletter with no recording sections', async () => {
    await expect(startPodcastDraft({
      issueEvent: newsletter({ content: 'No headings in this issue.' }),
      signer: signer(),
      expectedPubkey: 'a'.repeat(64),
      save: { fetchLatest: vi.fn(), publish: vi.fn(), delay: vi.fn() },
    })).rejects.toThrow(/no sections/)
  })

  it('does not publish when a manifest already exists', async () => {
    const existing = savedManifest({
      issueRef: 'naddr1existing',
      episodeStatus: 'draft',
      sections: [],
      publishedRss: null,
    })
    const publish = vi.fn()
    await expect(startPodcastDraft({
      issueEvent: newsletter(),
      signer: signer(),
      expectedPubkey: 'a'.repeat(64),
      save: {
        fetchLatest: vi.fn().mockResolvedValue(existing),
        publish,
        delay: vi.fn(),
      },
    })).rejects.toThrow(/changed elsewhere/)
    expect(publish).not.toHaveBeenCalled()
  })

  it('refuses a Compass issue from before the Logbook cutoff', async () => {
    await expect(startPodcastDraft({
      issueEvent: newsletter({ created_at: LOGBOOK_FROM_SECONDS - 1 }),
      signer: signer(),
      expectedPubkey: 'a'.repeat(64),
      save: { fetchLatest: vi.fn(), publish: vi.fn(), delay: vi.fn() },
    })).rejects.toThrow(/not a Logbook episode/)
  })
})
