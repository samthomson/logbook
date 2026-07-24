import type { CompassIssue, ManifestContent, ManifestSection, Segment } from '../types/nostr'

const EVENT_ID = /^[0-9a-f]{64}$/

export interface RecordingTarget {
  id: string
  title: string
}

export type WorkspaceRowState = 'included' | 'excluded' | 'inventory'

export interface WorkspaceRow {
  rowKey: string
  segmentId: string
  segment?: Segment
  state: WorkspaceRowState
  isNew: boolean
  isIntro: boolean
  reviewed: boolean
  unavailable: boolean
  problem?: string
}

export interface WorkspaceReferenceIssue {
  sectionId: string
  source: 'introEventId' | 'order' | 'excluded' | 'reviewed'
  segmentId: string
  active: boolean
  reason: 'Invalid recording reference' | 'Recording unavailable' | 'Duplicate active recording' | 'Intro missing from playback order'
}

export interface WorkspaceChapter {
  id: string
  title: string
  sectionIndex: number | null
  sectionExcluded: boolean
  legacy: boolean
  inventoryOnly: boolean
  rows: WorkspaceRow[]
  issues: WorkspaceReferenceIssue[]
}

export interface ManifestReferenceValidation {
  issues: WorkspaceReferenceIssue[]
  canLock: boolean
}

export function buildRecordingTargets(issue: CompassIssue): RecordingTarget[] {
  return issue.sections.flatMap((group) => {
    const named = group.items
      .filter((item): item is typeof item & { id: string } => Boolean(item.title && item.id))
      .map((item) => ({ id: item.id, title: item.title }))
    const lead = group.items.find((item) => !item.title)
    return lead?.body.trim() || named.length === 0
      ? [{ id: group.id, title: group.title }, ...named]
      : named
  })
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

/** Canonical persisted shape for semantic dirty checks and publishing. */
export function canonicalizeManifestContent(content: ManifestContent): ManifestContent {
  return {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      sectionExcluded: section.sectionExcluded === true,
      // Playback order is positional; duplicates are validation errors, not a
      // set-normalization opportunity. Preserve them until the editor acts.
      order: [...section.order],
      excluded: unique(section.excluded).sort(),
      reviewed: unique(section.reviewed).sort(),
    })),
  }
}

export function isManifestDirty(base: ManifestContent, draft: ManifestContent): boolean {
  return JSON.stringify(canonicalizeManifestContent(base)) !== JSON.stringify(canonicalizeManifestContent(draft))
}

function issueFor(
  sectionId: string,
  source: WorkspaceReferenceIssue['source'],
  segmentId: string,
  active: boolean,
  inventory: ReadonlyMap<string, Segment>,
): WorkspaceReferenceIssue | null {
  if (!EVENT_ID.test(segmentId)) {
    return { sectionId, source, segmentId, active, reason: 'Invalid recording reference' }
  }
  if (!inventory.has(segmentId)) {
    return { sectionId, source, segmentId, active, reason: 'Recording unavailable' }
  }
  return null
}

export function validateManifestReferences(
  content: ManifestContent,
  inventory: ReadonlyMap<string, Segment>,
): ManifestReferenceValidation {
  const issues: WorkspaceReferenceIssue[] = []
  const activeOwners = new Map<string, string>()
  let activeCount = 0

  for (const section of content.sections) {
    const sectionActive = section.sectionExcluded !== true && section.introEventId !== 'excluded'
    const excluded = new Set(section.excluded)
    const activeReferences: Array<{ source: 'introEventId' | 'order'; id: string }> = []
    if (section.introEventId && section.introEventId !== 'excluded' && !excluded.has(section.introEventId)) {
      if (!section.order.includes(section.introEventId)) {
        issues.push({
          sectionId: section.id,
          source: 'introEventId',
          segmentId: section.introEventId,
          active: sectionActive,
          reason: 'Intro missing from playback order',
        })
      }
      activeReferences.push({ source: 'introEventId', id: section.introEventId })
    }
    for (const id of section.order) {
      if (!excluded.has(id)) activeReferences.push({ source: 'order', id })
    }

    const sameSection = new Map<string, Set<'introEventId' | 'order'>>()
    for (const reference of activeReferences) {
      const priorSources = sameSection.get(reference.id) ?? new Set<'introEventId' | 'order'>()
      // One intro pointer may alias one order entry. Every other repeated active
      // reference is malformed and must survive until the editor resolves it.
      const allowedIntroAlias = reference.source === 'order'
        && priorSources.has('introEventId')
        && !priorSources.has('order')
      if (priorSources.size > 0 && !allowedIntroAlias) {
        issues.push({
          sectionId: section.id,
          source: reference.source,
          segmentId: reference.id,
          active: sectionActive,
          reason: 'Duplicate active recording',
        })
        priorSources.add(reference.source)
        sameSection.set(reference.id, priorSources)
        continue
      }
      priorSources.add(reference.source)
      sameSection.set(reference.id, priorSources)
      if (allowedIntroAlias) continue
      const active = sectionActive
      const referenceIssue = issueFor(section.id, reference.source, reference.id, active, inventory)
      if (referenceIssue) issues.push(referenceIssue)
      if (!active || referenceIssue) continue
      const owner = activeOwners.get(reference.id)
      if (owner && owner !== section.id) {
        issues.push({
          sectionId: section.id,
          source: reference.source,
          segmentId: reference.id,
          active: true,
          reason: 'Duplicate active recording',
        })
      } else {
        activeOwners.set(reference.id, section.id)
        activeCount += 1
      }
    }

    for (const id of section.excluded) {
      const referenceIssue = issueFor(section.id, 'excluded', id, false, inventory)
      if (referenceIssue) issues.push(referenceIssue)
    }
    for (const id of section.reviewed) {
      const active = sectionActive && sameSection.has(id)
      const referenceIssue = issueFor(section.id, 'reviewed', id, active, inventory)
      if (referenceIssue) issues.push(referenceIssue)
    }
  }

  return {
    issues,
    canLock: content.episodeStatus === 'draft' && activeCount > 0 && !issues.some((item) => item.active),
  }
}

export function removeManifestReference(
  content: ManifestContent,
  reference: WorkspaceReferenceIssue,
): ManifestContent {
  const sectionIndex = content.sections.findIndex((section) => section.id === reference.sectionId)
  if (sectionIndex < 0) return content
  return {
    ...content,
    sections: content.sections.map((section, index) => {
      if (index !== sectionIndex) return section
      if (reference.source === 'introEventId') return { ...section, introEventId: null }
      return {
        ...section,
        [reference.source]: section[reference.source].filter((id) => id !== reference.segmentId),
      }
    }),
  }
}

function sectionRows(
  section: ManifestSection | undefined,
  chapterId: string,
  inventory: ReadonlyMap<string, Segment>,
  claimed: Set<string>,
  issues: WorkspaceReferenceIssue[],
): WorkspaceRow[] {
  const rows: WorkspaceRow[] = []
  if (section) {
    const excluded = new Set(section.excluded)
    const ids: Array<{ id: string; state: WorkspaceRowState; intro: boolean }> = []
    if (
      section.introEventId &&
      section.introEventId !== 'excluded' &&
      !section.order.includes(section.introEventId) &&
      !excluded.has(section.introEventId)
    ) ids.push({ id: section.introEventId, state: 'included', intro: true })
    for (const id of section.order) {
      if (!excluded.has(id)) ids.push({ id, state: 'included', intro: id === section.introEventId })
    }
    for (const id of section.excluded) ids.push({ id, state: 'excluded', intro: id === section.introEventId })

    for (const entry of ids) {
      if (claimed.has(entry.id)) continue
      claimed.add(entry.id)
      const segment = inventory.get(entry.id)
      const problem = issues.find((item) => item.sectionId === section.id && item.segmentId === entry.id)?.reason
      rows.push({
        rowKey: `${section.id}:${entry.state}:${entry.id}`,
        segmentId: entry.id,
        segment,
        state: entry.state,
        isNew: false,
        isIntro: entry.intro || segment?.isIntro === true,
        reviewed: section.reviewed.includes(entry.id),
        unavailable: !segment,
        problem,
      })
    }
  }

  const discovered = [...inventory.values()]
    .filter((segment) => segment.sectionId === chapterId && !claimed.has(segment.event.id))
    .sort((a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id))
  for (const segment of discovered) {
    claimed.add(segment.event.id)
    rows.push({
      rowKey: `${chapterId}:inventory:${segment.event.id}`,
      segmentId: segment.event.id,
      segment,
      state: 'inventory',
      isNew: true,
      isIntro: segment.isIntro,
      reviewed: false,
      unavailable: false,
    })
  }
  return rows
}

export function projectAdminWorkspace(
  issue: CompassIssue,
  draft: ManifestContent,
  inventory: ReadonlyMap<string, Segment>,
): WorkspaceChapter[] {
  const targets = buildRecordingTargets(issue)
  const targetIds = new Set(targets.map((target) => target.id))
  const sectionIndex = new Map(draft.sections.map((section, index) => [section.id, index]))
  const validation = validateManifestReferences(draft, inventory)
  const claimed = new Set<string>()

  const chapters: WorkspaceChapter[] = targets.map((target) => {
    const index = sectionIndex.get(target.id) ?? null
    const section = index === null ? undefined : draft.sections[index]
    const issues = validation.issues.filter((item) => item.sectionId === target.id)
    return {
      id: target.id,
      title: target.title,
      sectionIndex: index,
      sectionExcluded: section?.sectionExcluded === true || section?.introEventId === 'excluded',
      legacy: false,
      inventoryOnly: false,
      rows: sectionRows(section, target.id, inventory, claimed, issues),
      issues,
    }
  })

  for (const [index, section] of draft.sections.entries()) {
    if (targetIds.has(section.id)) continue
    const issues = validation.issues.filter((item) => item.sectionId === section.id)
    chapters.push({
      id: section.id,
      title: `Unassigned · ${section.title || section.id}`,
      sectionIndex: index,
      sectionExcluded: section.sectionExcluded === true || section.introEventId === 'excluded',
      legacy: true,
      inventoryOnly: false,
      rows: sectionRows(section, section.id, inventory, claimed, issues),
      issues,
    })
  }

  const unknown = [...inventory.values()]
    .filter((segment) => !claimed.has(segment.event.id))
    .sort((a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id))
  if (unknown.length) {
    chapters.push({
      id: '__unassigned-recordings__',
      title: 'Unassigned recordings',
      sectionIndex: null,
      sectionExcluded: false,
      legacy: false,
      inventoryOnly: true,
      issues: [],
      rows: unknown.map((segment) => ({
        rowKey: `unassigned:inventory:${segment.event.id}`,
        segmentId: segment.event.id,
        segment,
        state: 'inventory' as const,
        isNew: true,
        isIntro: segment.isIntro,
        reviewed: false,
        unavailable: false,
      })),
    })
  }
  return chapters
}

export function includeInventorySegment(
  content: ManifestContent,
  targets: RecordingTarget[],
  segment: Segment,
): ManifestContent {
  const existingIndex = content.sections.findIndex((section) => section.id === segment.sectionId)
  if (existingIndex >= 0) {
    const section = content.sections[existingIndex]
    if (section.order.includes(segment.event.id) && !section.excluded.includes(segment.event.id)) return content
    return {
      ...content,
      sections: content.sections.map((candidate, index) => index === existingIndex ? {
        ...candidate,
        order: [...candidate.order.filter((id) => id !== segment.event.id), segment.event.id],
        excluded: candidate.excluded.filter((id) => id !== segment.event.id),
      } : candidate),
    }
  }

  if (content.sections.some((section) =>
    section.order.includes(segment.event.id) || section.excluded.includes(segment.event.id))) return content

  const targetPosition = targets.findIndex((target) => target.id === segment.sectionId)
  const target = targets[targetPosition]
  const created: ManifestSection = {
    id: segment.sectionId,
    title: target?.title ?? segment.sectionId,
    introEventId: segment.isIntro ? segment.event.id : null,
    sectionExcluded: false,
    order: [segment.event.id],
    excluded: [],
    reviewed: [],
  }
  if (targetPosition < 0) return { ...content, sections: [...content.sections, created] }

  const insertion = content.sections.findIndex((section) => {
    const position = targets.findIndex((candidate) => candidate.id === section.id)
    return position < 0 || position > targetPosition
  })
  const index = insertion < 0 ? content.sections.length : insertion
  return {
    ...content,
    sections: [...content.sections.slice(0, index), created, ...content.sections.slice(index)],
  }
}
