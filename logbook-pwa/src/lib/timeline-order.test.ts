import { describe, expect, it } from 'vitest'
import { orderTimelineSegments } from './timeline-order'

const segment = (id: string, created_at: number) => ({ event: { id, created_at } })

describe('orderTimelineSegments', () => {
  it('uses the verified manifest EDL, excludes cut notes, and appends late notes deterministically', () => {
    const a = segment('a', 1)
    const b = segment('b', 2)
    const late = segment('late', 3)

    expect(orderTimelineSegments([a, b, late], ['b', 'missing', 'a'], ['a'])).toEqual(['b', 'late'])
  })

  it('falls back to the deterministic seed when no manifest EDL exists', () => {
    const a = segment('a', 2)
    const b = segment('b', 1)
    expect(orderTimelineSegments([a, b], [], [])).toEqual(['b', 'a'])
  })
})
