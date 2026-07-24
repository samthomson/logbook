export interface LatestRequestGuard {
  begin(): number
  invalidate(): void
  isCurrent(request: number): boolean
}

/** Require both a parent capability and its child operation to still be current. */
export function areRequestScopesCurrent(
  parent: LatestRequestGuard,
  parentRequest: number | null,
  child: LatestRequestGuard,
  childRequest: number,
): boolean {
  return parentRequest !== null
    && parent.isCurrent(parentRequest)
    && child.isCurrent(childRequest)
}

/** Monotonic gate for ignoring async results after a newer request or reset. */
export function createLatestRequestGuard(): LatestRequestGuard {
  let generation = 0
  return {
    begin: () => ++generation,
    invalidate: () => { generation += 1 },
    isCurrent: (request) => request === generation,
  }
}
