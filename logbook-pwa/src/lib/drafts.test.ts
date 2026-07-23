import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { clearDrafts, deleteDraft, listDrafts, saveDraft, type RecordingDraft } from './drafts'

const baseDraft: RecordingDraft = {
  id: 'draft-1',
  issueNumber: 32,
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
