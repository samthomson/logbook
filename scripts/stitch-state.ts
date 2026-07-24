export interface StitchManifestSection {
  id: string
  title: string
  introEventId: string | null
  sectionExcluded?: boolean
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
  {
    force = false,
    requiredChapterIds = [],
  }: { force?: boolean; requiredChapterIds?: readonly string[] } = {},
): 'run' | 'already-published' {
  if (manifest.episodeStatus === 'cutting') {
    assertEveryChapterIncluded(manifest.sections, requiredChapterIds)
    return 'run'
  }
  if (manifest.episodeStatus === 'published') {
    if (force) {
      assertEveryChapterIncluded(manifest.sections, requiredChapterIds)
      return 'run'
    }
    return 'already-published'
  }
  throw new Error(`Manifest is not locked/cutting (current status: ${manifest.episodeStatus})`)
}

function assertEveryChapterIncluded(
  sections: StitchManifestSection[],
  requiredChapterIds: readonly string[],
): void {
  const presentIds = new Set(sections.map((section) => section.id))
  const missing = requiredChapterIds.find((id) => !presentIds.has(id))
  if (missing) {
    throw new Error(`Every newsletter chapter must be included; missing required chapter: ${missing}`)
  }
  const invalid = sections.find((section) =>
    section.sectionExcluded === true ||
    section.introEventId === 'excluded' ||
    !section.order.some((id) => !section.excluded.includes(id)),
  )
  if (!sections.length || invalid) {
    throw new Error(
      `Every newsletter chapter must have an active recording before release${invalid ? ` (chapter: ${invalid.title})` : ''}.`,
    )
  }
}

export function selectActiveSections(sections: StitchManifestSection[]): StitchManifestSection[] {
  return sections.filter((section) =>
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
