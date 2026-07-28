import type { NostrEvent } from '../types/nostr'

/** Bound relay-controlled revision ordering without rejecting ordinary clock skew. */
export const MAX_FUTURE_EVENT_SKEW_SECONDS = 10 * 60

export function latestReasonableEventTimestamp(nowSeconds = Math.floor(Date.now() / 1000)): number {
  return nowSeconds + MAX_FUTURE_EVENT_SKEW_SECONDS
}

export function hasReasonableEventTimestamp(
  event: Pick<NostrEvent, 'created_at'>,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return Number.isSafeInteger(event.created_at)
    && event.created_at >= 0
    && event.created_at <= nowSeconds + MAX_FUTURE_EVENT_SKEW_SECONDS
}
