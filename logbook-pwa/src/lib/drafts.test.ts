import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { clearDrafts, deleteDraft, draftBelongsTo, listDrafts, saveDraft, selectDraftForPrincipal, type RecordingDraft } from './drafts'

const baseDraft: RecordingDraft = {
  id: 'draft-1',
  issueNumber: 32,
  ownerPubkey: 'a'.repeat(64),
  target: { sectionId: 'sec-intro-32', respondingTo: null },
  blob: new Blob(['audio'], { type: 'audio/webm' }),
  duration: 2,
  waveform: [0.1, 0.2],
  descriptor: null,
  updatedAt: 100,
}

afterEach(async () => { await clearDrafts() })

describe('recording drafts', () => {
  it('persists and retrieves a crash-safe recording blob by issue', async () => {
    await saveDraft(baseDraft)
    const drafts = await listDrafts(32)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ id: 'draft-1', issueNumber: 32, duration: 2, descriptor: null })
    expect(await drafts[0].blob.text()).toBe('audio')
  })

  it('binds resume and deletion authority to the authenticated draft owner', () => {
    const alice = baseDraft
    const bob = { ...baseDraft, id: 'draft-2', ownerPubkey: 'b'.repeat(64), updatedAt: 200 }
    const drafts = [bob, alice]

    expect(selectDraftForPrincipal(drafts, alice.ownerPubkey)?.id).toBe(alice.id)
    expect(selectDraftForPrincipal(drafts, bob.ownerPubkey)?.id).toBe(bob.id)
    expect(selectDraftForPrincipal(drafts, null)?.id).toBe(bob.id)
    expect(draftBelongsTo(alice, alice.ownerPubkey)).toBe(true)
    expect(draftBelongsTo(alice, bob.ownerPubkey)).toBe(false)
    expect(draftBelongsTo(alice, null)).toBe(false)
  })

  it('fails closed for legacy drafts without an owner', () => {
    const legacy = { ...baseDraft, ownerPubkey: undefined } as unknown as RecordingDraft
    expect(selectDraftForPrincipal([legacy], baseDraft.ownerPubkey)).toBeUndefined()
    expect(selectDraftForPrincipal([legacy], null)).toBe(legacy)
    expect(draftBelongsTo(legacy, baseDraft.ownerPubkey)).toBe(false)
  })

  it('upserts descriptor state and removes completed drafts', async () => {
    await saveDraft(baseDraft)
    await saveDraft({ ...baseDraft, descriptor: { url: 'https://blossom.example/hash', sha256: 'a'.repeat(64), mime: 'audio/webm', size: 5, uploaded: 200 }, updatedAt: 200 })
    const [saved] = await listDrafts(32)
    expect(saved.descriptor?.url).toContain('blossom.example')
    expect(saved.updatedAt).toBe(200)

    await deleteDraft('draft-1')
    expect(await listDrafts(32)).toEqual([])
  })
})
