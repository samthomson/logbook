import { describe, expect, it } from 'vitest'
import { areRequestScopesCurrent, createLatestRequestGuard } from './latest-request'

describe('latest request guard', () => {
  it('accepts only the newest request in a scope', () => {
    const guard = createLatestRequestGuard()
    const first = guard.begin()
    const second = guard.begin()

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
  })

  it('invalidates an in-flight request on logout or local selection', () => {
    const guard = createLatestRequestGuard()
    const request = guard.begin()

    guard.invalidate()

    expect(guard.isCurrent(request)).toBe(false)
  })

  it('rejects a stale child callback even if it begins after parent capability revocation', () => {
    const capability = createLatestRequestGuard()
    const operations = createLatestRequestGuard()
    const capabilityRequest = capability.begin()

    capability.invalidate()
    const staleOperation = operations.begin()

    expect(capability.isCurrent(capabilityRequest)).toBe(false)
    expect(operations.isCurrent(staleOperation)).toBe(true)
    expect(areRequestScopesCurrent(
      capability,
      capabilityRequest,
      operations,
      staleOperation,
    )).toBe(false)
  })

  it('rejects an older async completion that resolves after the newest one', async () => {
    const guard = createLatestRequestGuard()
    let releaseFirst: () => void = () => {}
    let releaseSecond: () => void = () => {}
    const firstDone = new Promise<void>((resolve) => { releaseFirst = resolve })
    const secondDone = new Promise<void>((resolve) => { releaseSecond = resolve })
    let applied = ''

    const run = async (request: number, value: string, done: Promise<void>) => {
      await done
      if (guard.isCurrent(request)) applied = value
    }

    const first = run(guard.begin(), 'old identity', firstDone)
    const second = run(guard.begin(), 'current identity', secondDone)
    releaseSecond()
    await second
    releaseFirst()
    await first

    expect(applied).toBe('current identity')
  })
})
