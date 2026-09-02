export interface CurationNode {
  id: string
  sectionId: string
  createdAt: number
  respondingTo?: string | null
  transcript?: string
  duration?: number
  validatedContributor?: boolean
}

export interface CurationProposal {
  source: 'ai' | 'deterministic'
  reviewRequired: true
  sections: Array<{ id: string; order: string[] }>
  warning?: string
}

export type ProposalModel = (input: string) => Promise<string>

const EVENT_ID = /^[0-9a-f]{64}$/

export function deterministicProposal(nodes: readonly CurationNode[]): CurationProposal {
  const groups = new Map<string, CurationNode[]>()
  for (const node of nodes) groups.set(node.sectionId, [...(groups.get(node.sectionId) ?? []), node])
  return {
    source: 'deterministic',
    reviewRequired: true,
    sections: [...groups].map(([id, entries]) => ({
      id,
      order: entries.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map((entry) => entry.id),
    })),
  }
}

export function validateModelProposal(value: unknown, nodes: readonly CurationNode[]): CurationProposal['sections'] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { sections?: unknown }).sections)) throw new Error('AI proposal must contain sections')
  const allowed = new Map(nodes.map((node) => [node.id, node.sectionId]))
  const allowedSections = new Set(nodes.map((node) => node.sectionId))
  const seen = new Set<string>()
  const seenSections = new Set<string>()
  return (value as { sections: unknown[] }).sections.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid AI section')
    const section = raw as { id?: unknown; order?: unknown }
    if (typeof section.id !== 'string' || !allowedSections.has(section.id) || seenSections.has(section.id) || !Array.isArray(section.order)) throw new Error('Invalid or duplicate AI section')
    seenSections.add(section.id)
    const order = section.order.map((id) => {
      if (typeof id !== 'string' || !EVENT_ID.test(id) || allowed.get(id) !== section.id || seen.has(id)) throw new Error('AI proposal contains an unknown, misplaced, or duplicate segment ID')
      seen.add(id)
      return id
    })
    return { id: section.id, order }
  })
}

/** Produces data for explicit producer review; this module has no signer or publish path. */
export async function proposeCuration(nodes: readonly CurationNode[], model?: ProposalModel): Promise<CurationProposal> {
  const fallback = deterministicProposal(nodes)
  if (!model) return { ...fallback, warning: 'AI is not configured; deterministic order is ready for manual review.' }
  try {
    const raw = await model(JSON.stringify({ instruction: 'Select and order segment IDs. Return JSON only.', nodes }))
    return { source: 'ai', reviewRequired: true, sections: validateModelProposal(JSON.parse(raw), nodes) }
  } catch {
    return { ...fallback, warning: 'AI proposal unavailable; deterministic order is ready for manual review.' }
  }
}
