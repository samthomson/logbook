import { describe, expect, it, vi } from 'vitest'
import type { IssueManifest, ManifestContent, NostrEvent } from '../types/nostr'
import { createAdminSaveController } from './admin-save'

const BASE_ID = '1'.repeat(64)
const SAVED_ID = '2'.repeat(64)
const OTHER_ID = '3'.repeat(64)

function content(): ManifestContent {
  return {
    issueRef: 'naddr1fixture',
    episodeStatus: 'draft',
    sections: [],
    publishedRss: null,
  }
}

function event(id: string): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: 1,
    kind: 34200,
    tags: [['d', 'logbook-31']],
    content: JSON.stringify(content()),
    sig: 'b'.repeat(128),
  }
}

function manifest(id = BASE_ID): IssueManifest {
  return { event: event(id), issueId: 'logbook-31', content: content() }
}

describe('admin save controller', () => {
  it('publishes exactly once after an exact preflight and acknowledges its own revision', async () => {
    const latest = vi.fn()
      .mockResolvedValueOnce(manifest(BASE_ID))
      .mockResolvedValueOnce(manifest(SAVED_ID))
    const publish = vi.fn().mockResolvedValue(event(SAVED_ID))
    const controller = createAdminSaveController({ fetchLatest: latest, publish, delay: vi.fn() })

    await expect(controller.save(manifest(BASE_ID), content())).resolves.toMatchObject({
      event: { id: SAVED_ID },
    })
    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(content(), BASE_ID, 1)
  })

  it.each([
    ['refetch failure', () => Promise.reject(new Error('relay down'))],
    ['null mismatch', () => Promise.resolve(null)],
    ['stale base', () => Promise.resolve(manifest(OTHER_ID))],
  ])('%s retains the draft and publishes nothing', async (_label, firstFetch) => {
    const publish = vi.fn()
    const controller = createAdminSaveController({
      fetchLatest: vi.fn(firstFetch),
      publish,
      delay: vi.fn(),
    })
    await expect(controller.save(manifest(BASE_ID), content())).rejects.toThrow()
    expect(publish).not.toHaveBeenCalled()
  })

  it('retries an old base during propagation and then accepts its own revision', async () => {
    const latest = vi.fn()
      .mockResolvedValueOnce(manifest(BASE_ID))
      .mockResolvedValueOnce(manifest(BASE_ID))
      .mockResolvedValueOnce(manifest(BASE_ID))
      .mockResolvedValueOnce(manifest(SAVED_ID))
    const delay = vi.fn().mockResolvedValue(undefined)
    const controller = createAdminSaveController({
      fetchLatest: latest,
      publish: vi.fn().mockResolvedValue(event(SAVED_ID)),
      delay,
    })
    await expect(controller.save(manifest(BASE_ID), content())).resolves.toBeTruthy()
    expect(delay).toHaveBeenNthCalledWith(1, 250)
    expect(delay).toHaveBeenNthCalledWith(2, 500)
  })

  it('reports a competing post-publish revision and does not treat the draft as saved', async () => {
    const controller = createAdminSaveController({
      fetchLatest: vi.fn()
        .mockResolvedValueOnce(manifest(BASE_ID))
        .mockResolvedValueOnce(manifest(OTHER_ID)),
      publish: vi.fn().mockResolvedValue(event(SAVED_ID)),
      delay: vi.fn(),
    })
    await expect(controller.save(manifest(BASE_ID), content())).rejects.toThrow(/conflict/i)
  })

  it('coalesces repeated invocation while a save is pending', async () => {
    let release!: (value: IssueManifest) => void
    const preflight = new Promise<IssueManifest>((resolve) => { release = resolve })
    const fetchLatest = vi.fn()
      .mockReturnValueOnce(preflight)
      .mockResolvedValueOnce(manifest(SAVED_ID))
    const publish = vi.fn().mockResolvedValue(event(SAVED_ID))
    const controller = createAdminSaveController({ fetchLatest, publish, delay: vi.fn() })

    const first = controller.save(manifest(BASE_ID), content())
    const second = controller.save(manifest(BASE_ID), content())
    expect(first).toBe(second)
    release(manifest(BASE_ID))
    await first
    expect(publish).toHaveBeenCalledOnce()
  })

  it('creates the first manifest only after confirming that no manifest exists', async () => {
    const latest = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(manifest(SAVED_ID))
    const publish = vi.fn().mockResolvedValue(event(SAVED_ID))
    const controller = createAdminSaveController({ fetchLatest: latest, publish, delay: vi.fn() })
    await controller.save(null, content())
    expect(publish).toHaveBeenCalledWith(content(), null, null)
  })

  it('does not publish when admin capability is revoked during the preflight await', async () => {
    let active = true
    const publish = vi.fn()
    const controller = createAdminSaveController({
      fetchLatest: vi.fn(async () => {
        active = false
        return manifest(BASE_ID)
      }),
      publish,
      delay: vi.fn(),
    })
    const assertActive = () => {
      if (!active) throw new Error('Admin capability was revoked')
    }

    await expect(controller.save(manifest(BASE_ID), content(), assertActive))
      .rejects.toThrow('Admin capability was revoked')
    expect(publish).not.toHaveBeenCalled()
  })
})
