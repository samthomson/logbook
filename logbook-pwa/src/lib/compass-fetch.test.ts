import { describe, expect, it, vi } from 'vitest'

const querySync = vi.hoisted(() => vi.fn().mockResolvedValue([]))

vi.mock('./pool', () => ({
  getPool: () => ({ querySync }),
}))

import { COMPASS_PUBKEY } from '../config'
import { fetchLatestIssueWithSegments } from './compass'

describe('initial issue relay budget', () => {
  it('scans only a bounded recent issue window on the startup path', async () => {
    await fetchLatestIssueWithSegments(['wss://performance.test'])

    expect(querySync).toHaveBeenCalled()
    expect(querySync.mock.calls[0]?.[1]).toMatchObject({
      kinds: [30023],
      authors: [COMPASS_PUBKEY],
      limit: 12,
    })
  })
})
