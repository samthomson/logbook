export interface StitchManifestSection {
  id: string
  title: string
  introEventId: string | null
  order: string[]
  excluded: string[]
}

export interface StitchManifestState {
  episodeStatus: string
  sections: StitchManifestSection[]
}

/** A stitch run is permitted only after an admin has locked the cut. */
export function assertStitchableManifest(
  manifest: StitchManifestState,
  { force = false }: { force?: boolean } = {},
): 'run' | 'already-published' {
  if (manifest.episodeStatus === 'cutting') return 'run'
  if (manifest.episodeStatus === 'published') {
    if (force) return 'run'
    return 'already-published'
  }
  throw new Error(`Manifest is not locked/cutting (current status: ${manifest.episodeStatus})`)
}

export function selectActiveSections(sections: StitchManifestSection[]): StitchManifestSection[] {
  return sections.filter((section) =>
    section.introEventId !== 'excluded' &&
    section.order.some((id) => !section.excluded.includes(id)),
  )
}

export function collectLockedSegmentIds(sections: StitchManifestSection[]): string[] {
  return [...new Set(sections.flatMap((section) =>
    section.order.filter((id) => !section.excluded.includes(id)),
  ))]
}

/** Refuse a locked cut with any missing or untrusted segment event. */
export function assertLockedSegmentsPresent(
  sections: StitchManifestSection[],
  segments: ReadonlyMap<string, unknown>,
): void {
  for (const section of sections) {
    for (const id of section.order) {
      if (section.excluded.includes(id)) continue
      if (!segments.has(id)) {
        throw new Error(
          `[stitch] Segment ${id} is in the locked manifest but not on any relay. ` +
          'Fix the manifest (exclude it) and re-lock, or restore the segment event.',
        )
      }
    }
  }
}
