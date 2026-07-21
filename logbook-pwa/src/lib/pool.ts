/**
 * Shared SimplePool — one WebSocket connection set for the whole app.
 * Every lib module previously created its own pool (4× the relay connections).
 */

import { SimplePool } from 'nostr-tools/pool'

let _pool: SimplePool | null = null

export function getPool(): SimplePool {
  if (!_pool) _pool = new SimplePool()
  return _pool
}
