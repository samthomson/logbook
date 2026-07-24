import type { IssueManifest, ManifestContent, NostrEvent } from '../types/nostr'

export interface AdminSaveDependencies {
  fetchLatest: () => Promise<IssueManifest | null>
  publish: (
    content: ManifestContent,
    previousEventId: string | null,
    previousCreatedAt: number | null,
  ) => Promise<NostrEvent>
  delay?: (milliseconds: number) => Promise<void>
}

export interface AdminSaveController {
  save: (baseManifest: IssueManifest | null, draftContent: ManifestContent) => Promise<IssueManifest>
  isSaving: () => boolean
}

const propagationDelays = [250, 500, 1000]
const defaultDelay = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds)
})

export function createAdminSaveController(dependencies: AdminSaveDependencies): AdminSaveController {
  let pending: Promise<IssueManifest> | null = null
  const delay = dependencies.delay ?? defaultDelay

  const run = async (baseManifest: IssueManifest | null, draftContent: ManifestContent): Promise<IssueManifest> => {
    const baseEventId = baseManifest?.event.id ?? null
    let latest: IssueManifest | null
    try {
      latest = await dependencies.fetchLatest()
    } catch (error) {
      throw new Error('Couldn’t verify the current episode — nothing was saved', { cause: error })
    }
    if ((latest?.event.id ?? null) !== baseEventId) {
      throw new Error('Episode changed elsewhere — reload before saving')
    }

    const published = await dependencies.publish(
      draftContent,
      baseEventId,
      baseManifest?.event.created_at ?? null,
    )
    for (let attempt = 0; attempt <= propagationDelays.length; attempt += 1) {
      let acknowledged: IssueManifest | null
      try {
        acknowledged = await dependencies.fetchLatest()
      } catch (error) {
        if (attempt === propagationDelays.length) {
          throw new Error('Couldn’t verify the saved episode revision — your draft is retained', { cause: error })
        }
        await delay(propagationDelays[attempt])
        continue
      }
      if (acknowledged?.event.id === published.id) return acknowledged
      if (acknowledged && acknowledged.event.id !== baseEventId) {
        throw new Error('Save conflict — another episode revision became current; your draft is retained')
      }
      if (attempt < propagationDelays.length) await delay(propagationDelays[attempt])
    }
    throw new Error('Saved revision was not acknowledged by relays — your draft is retained')
  }

  return {
    save(baseManifest, draftContent) {
      if (pending) return pending
      pending = run(baseManifest, draftContent).finally(() => { pending = null })
      return pending
    },
    isSaving: () => pending !== null,
  }
}
