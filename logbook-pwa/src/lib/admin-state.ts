import { arrayMove } from '@dnd-kit/sortable'
import { COMPASS_PUBKEY } from '../config'
import type { ManifestContent, ManifestSection } from '../types/nostr'

function updateSection(
  content: ManifestContent,
  sectionIndex: number,
  update: (section: ManifestSection) => ManifestSection,
): ManifestContent {
  return {
    ...content,
    sections: content.sections.map((section, index) =>
      index === sectionIndex ? update(section) : section),
  }
}

/**
 * Producers curate; Compass is always one. Membership comes from the
 * Compass-signed producer list, so this is delegated authority, not a second
 * trust root.
 */
export function canEditManifest(
  content: ManifestContent,
  pubkey: string,
  producers: ReadonlySet<string> = new Set([COMPASS_PUBKEY]),
): boolean {
  return content.episodeStatus === 'draft' && producers.has(pubkey.toLowerCase())
}

export function canReopenPublishedCut(
  content: ManifestContent,
  pubkey: string,
  producers: ReadonlySet<string> = new Set([COMPASS_PUBKEY]),
): boolean {
  if (!producers.has(pubkey.toLowerCase())) return false
  if (content.episodeStatus === 'published') return true
  return content.episodeStatus === 'cutting' && Boolean(content.lastFailure)
}

/** Published audio stays in the feed until the next publish lands. */
export function reopenPublishedCut(content: ManifestContent): ManifestContent {
  const failedLock = content.episodeStatus === 'cutting' && Boolean(content.lastFailure)
  if (content.episodeStatus !== 'published' && !failedLock) return content
  return {
    ...content,
    episodeStatus: 'draft',
    lastFailure: null,
    release: undefined,
  }
}

/** A chapter is in the stitch when it has a recording and was not left out. */
export function sectionInCut(section: ManifestSection): boolean {
  if (section.sectionExcluded === true || section.introEventId === 'excluded') return false
  return section.order.some((id) => !section.excluded.includes(id))
}

export function canLockEpisode(content: ManifestContent): boolean {
  return content.sections.some(sectionInCut)
}

export function includeAllChapters(
  content: ManifestContent,
  requiredChapters: ReadonlyArray<{ id: string; title: string }> = [],
): ManifestContent {
  const normalized = content.sections.map((section) => ({
    ...section,
    introEventId: section.introEventId === 'excluded' ? null : section.introEventId,
    sectionExcluded: false,
  }))
  const byId = new Map(normalized.map((section) => [section.id, section]))
  const requiredIds = new Set(requiredChapters.map((chapter) => chapter.id))
  const required = requiredChapters.map((chapter) => byId.get(chapter.id) ?? ({
    id: chapter.id,
    title: chapter.title,
    introEventId: null,
    sectionExcluded: false,
    order: [],
    excluded: [],
    reviewed: [],
  }))
  const legacy = normalized.filter((section) => !requiredIds.has(section.id))

  return {
    ...content,
    sections: requiredChapters.length > 0 ? [...required, ...legacy] : normalized,
  }
}

export function toggleSectionExcluded(
  content: ManifestContent,
  sectionIndex: number,
): ManifestContent {
  return updateSection(content, sectionIndex, (section) => {
    if (section.introEventId === 'excluded') {
      return { ...section, introEventId: null, sectionExcluded: false }
    }
    return { ...section, sectionExcluded: !section.sectionExcluded }
  })
}

export function reorderSection(
  content: ManifestContent,
  sectionIndex: number,
  activeId: string,
  overId: string,
): ManifestContent {
  return updateSection(content, sectionIndex, (section) => {
    const oldIndex = section.order.indexOf(activeId)
    const newIndex = section.order.indexOf(overId)
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return section
    if (activeId === section.introEventId || overId === section.introEventId) return section
    return { ...section, order: arrayMove(section.order, oldIndex, newIndex) }
  })
}

export function moveSectionRecording(
  content: ManifestContent,
  sectionIndex: number,
  segmentId: string,
  direction: -1 | 1,
): ManifestContent {
  const section = content.sections[sectionIndex]
  if (!section || segmentId === section.introEventId) return content
  const currentIndex = section.order.indexOf(segmentId)
  const targetIndex = currentIndex + direction
  const firstMovableIndex = section.introEventId ? 1 : 0
  if (currentIndex < 0 || targetIndex < firstMovableIndex || targetIndex >= section.order.length) return content
  return reorderSection(content, sectionIndex, segmentId, section.order[targetIndex])
}

export function addSegmentSection(
  content: ManifestContent,
  { id, title, segmentIds }: { id: string; title: string; segmentIds: string[] },
): ManifestContent {
  if (content.sections.some((section) => section.id === id)) return content
  const order = [...new Set(segmentIds)]
  if (!order.length) return content
  return {
    ...content,
    sections: [...content.sections, {
      id,
      title,
      introEventId: null,
      sectionExcluded: false,
      order,
      excluded: [],
      reviewed: [],
    }],
  }
}

export function includeSegmentInSection(
  content: ManifestContent,
  sectionIndex: number,
  segmentId: string,
): ManifestContent {
  return updateSection(content, sectionIndex, (section) => {
    if (section.order.includes(segmentId)) return section
    return {
      ...section,
      order: [...section.order, segmentId],
      excluded: section.excluded.filter((id) => id !== segmentId),
    }
  })
}

export function toggleSegmentExcluded(
  content: ManifestContent,
  sectionIndex: number,
  segmentId: string,
): ManifestContent {
  return updateSection(content, sectionIndex, (section) => {
    const isExcluded = section.excluded.includes(segmentId)
    return {
      ...section,
      excluded: isExcluded
        ? section.excluded.filter((id) => id !== segmentId)
        : [...section.excluded, segmentId],
      order: isExcluded
        ? [...section.order, segmentId]
        : section.order.filter((id) => id !== segmentId),
    }
  })
}

export function toggleSegmentReviewed(
  content: ManifestContent,
  sectionIndex: number,
  segmentId: string,
): ManifestContent {
  return updateSection(content, sectionIndex, (section) => ({
    ...section,
    reviewed: section.reviewed.includes(segmentId)
      ? section.reviewed.filter((id) => id !== segmentId)
      : [...section.reviewed, segmentId],
  }))
}
