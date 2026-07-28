interface InitialIssueDependencies<T> {
  loadSaved: (issueNumber: number) => Promise<T | null>
  loadPreferredLatest: () => Promise<T | null>
  issueNumberOf: (issue: T) => number
}

export interface InitialIssueResult<T> {
  selected: T | null
  newer: T | null
}

function rejection(result: PromiseSettledResult<unknown>): unknown {
  return result.status === 'rejected' ? result.reason : null
}

/**
 * Resolve the public episode independently of authentication.
 *
 * A saved selection remains authoritative, but the preferred latest episode is
 * fetched alongside it so the UI can advertise newer content. Either relay
 * lookup may fail without discarding a usable result from the other lookup.
 */
export async function loadInitialIssue<T>(
  savedIssueNumber: number | null,
  dependencies: InitialIssueDependencies<T>,
): Promise<InitialIssueResult<T>> {
  if (savedIssueNumber === null) {
    return { selected: await dependencies.loadPreferredLatest(), newer: null }
  }

  const [savedResult, latestResult] = await Promise.allSettled([
    dependencies.loadSaved(savedIssueNumber),
    dependencies.loadPreferredLatest(),
  ])
  const saved = savedResult.status === 'fulfilled' ? savedResult.value : null
  const latest = latestResult.status === 'fulfilled' ? latestResult.value : null
  const selected = saved ?? latest

  if (!selected) {
    const error = rejection(savedResult) ?? rejection(latestResult)
    if (error) throw error
    return { selected: null, newer: null }
  }

  const newer = saved && latest && dependencies.issueNumberOf(latest) > dependencies.issueNumberOf(saved)
    ? latest
    : null
  return { selected, newer }
}
