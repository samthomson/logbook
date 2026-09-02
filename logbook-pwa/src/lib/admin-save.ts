import type { IssueManifest, ManifestContent, NostrEvent } from '../types/nostr'

export interface AdminSaveDependencies {
  fetchLatest: (preferEventId?: string | null) => Promise<IssueManifest | null>
  publish: (
    content: ManifestContent,
    previousEventId: string | null,
    previousCreatedAt: number | null,
    assertActive?: () => void,
  ) => Promise<NostrEvent>
  delay?: (milliseconds: number) => Promise<void>
}

export interface AdminSaveController {
  save: (
    baseManifest: IssueManifest | null,
    draftContent: ManifestContent,
    assertActive?: () => void,
  ) => Promise<IssueManifest>
  isSaving: () => boolean
}

const propagationDelays = [250, 500, 1000]
const defaultDelay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds)
})

export function createAdminSaveController(dependencies: AdminSaveDependencies): AdminSaveController {
  let pending: Promise<IssueManifest> | null = null
  const delay = dependencies.delay ?? defaultDelay

  const run = async (
    baseManifest: IssueManifest | null,
    draftContent: ManifestContent,
    assertActive?: () => void,
  ): Promise<IssueManifest> => {
    assertActive?.()
    const baseEventId = baseManifest?.event.id ?? null
    let latest: IssueManifest | null
    try {
      latest = await dependencies.fetchLatest()
      assertActive?.()
    } catch (error) {
      assertActive?.()
      throw new Error('Couldn’t verify the current episode — nothing was saved', { cause: error })
    }
    if ((latest?.event.id ?? null) !== baseEventId) {
      throw new Error('Episode changed elsewhere — reload before saving')
    }

    assertActive?.()
    const published = assertActive
      ? await dependencies.publish(
          draftContent,
          baseEventId,
          baseManifest?.event.created_at ?? null,
          assertActive,
        )
      : await dependencies.publish(
          draftContent,
          baseEventId,
          baseManifest?.event.created_at ?? null,
        )
    assertActive?.()
    for (let attempt = 0; attempt <= propagationDelays.length; attempt += 1) {
      assertActive?.()
      let acknowledged: IssueManifest | null
      try {
        acknowledged = await dependencies.fetchLatest(published.id)
        assertActive?.()
      } catch (error) {
        assertActive?.()
        if (attempt === propagationDelays.length) {
          throw new Error('Couldn’t verify the saved episode revision — your draft is retained', { cause: error })
        }
        await delay(propagationDelays[attempt])
        assertActive?.()
        continue
      }
      if (acknowledged?.event.id === published.id) {
        let authoritative: IssueManifest | null
        try {
          // The preferred lookup proves our exact event reached a relay. A
          // separate unpreferred lookup decides which revision is current.
          authoritative = await dependencies.fetchLatest()
          assertActive?.()
        } catch (error) {
          assertActive?.()
          if (attempt === propagationDelays.length) {
            throw new Error('Couldn’t resolve the current episode after saving — your draft is retained', { cause: error })
          }
          await delay(propagationDelays[attempt])
          assertActive?.()
          continue
        }
        if (authoritative?.event.id === published.id) return authoritative
        if (authoritative && authoritative.event.id !== baseEventId) {
          throw new Error('Save conflict — your revision reached relays, but another episode revision is current; your draft is retained')
        }
        if (attempt < propagationDelays.length) {
          await delay(propagationDelays[attempt])
          assertActive?.()
          continue
        }
        throw new Error('Saved revision reached relays but was not selected as current — your draft is retained')
      }
      if (acknowledged && acknowledged.event.id !== baseEventId) {
        throw new Error('Save conflict — another episode revision became current; your draft is retained')
      }
      if (attempt < propagationDelays.length) {
        await delay(propagationDelays[attempt])
        assertActive?.()
      }
    }
    throw new Error('Saved revision was not acknowledged by relays — your draft is retained')
  }

  return {
    save(baseManifest, draftContent, assertActive) {
      if (pending) return pending
      pending = run(baseManifest, draftContent, assertActive).finally(() => { pending = null })
      return pending
    },
    isSaving: () => pending !== null,
  }
}
