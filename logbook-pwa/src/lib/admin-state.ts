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

export function canEditManifest(content: ManifestContent, pubkey: string): boolean {
  return content.episodeStatus === 'draft' && pubkey === COMPASS_PUBKEY
}

export function canLockEpisode(content: ManifestContent): boolean {
  return content.episodeStatus === 'draft' && content.sections.some((section) =>
    section.sectionExcluded !== true && section.order.some((id) => !section.excluded.includes(id)),
  )
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
