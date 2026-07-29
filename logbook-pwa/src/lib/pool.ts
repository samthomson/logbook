/**
 * Shared SimplePool — one WebSocket connection set for the whole app.
 * Every lib module previously created its own pool (4× the relay connections).
 */

import { SimplePool } from 'nostr-tools/pool'
import { rememberRelayVerifiedEvent } from './verified-event-cache'

let _pool: SimplePool | null = null

/**
 * Remember events only after SimplePool has accepted them. This lets downstream
 * trust filters reuse the pool's mandatory signature verification without
 * trusting a forgeable property copied onto a new event object.
 */
function instrumentVerifiedEvents(pool: SimplePool): SimplePool {
  const querySync = pool.querySync.bind(pool)
  pool.querySync = async (...args) => {
    const events = await querySync(...args)
    for (const event of events) rememberRelayVerifiedEvent(event)
    return events
  }

  const subscribeMany = pool.subscribeMany.bind(pool)
  pool.subscribeMany = (relays, filter, params) => subscribeMany(relays, filter, {
    ...params,
    onevent: (event) => {
      rememberRelayVerifiedEvent(event)
      params.onevent?.(event)
    },
  })

  return pool
}

export function getPool(): SimplePool {
  if (!_pool) _pool = instrumentVerifiedEvents(new SimplePool())
  return _pool
}
