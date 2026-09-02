export interface RequiredChapterTarget {
  id: string
  title: string
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/** Mirror the PWA's newsletter-to-recording-target projection at the release boundary. */
export function requiredChapterTargets(markdown: string, issueNumber: number): RequiredChapterTarget[] {
  const groups: Array<{ id: string; title: string; lead: string[]; items: RequiredChapterTarget[]; inItem: boolean }> = []
  let current: (typeof groups)[number] | null = null

  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim()
      current = {
        id: `sec-${slugify(title)}-${issueNumber}`,
        title,
        lead: [],
        items: [],
        inItem: false,
      }
      groups.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('### ')) {
      const title = line.slice(4).trim()
      const parentSlug = current.id.replace(/^sec-/, '').replace(/-\d+$/, '')
      current.items.push({
        id: `sec-${parentSlug}-${slugify(title)}-${issueNumber}`,
        title,
      })
      current.inItem = true
      continue
    }
    if (!current.inItem) current.lead.push(line)
  }

  const targets = groups.flatMap((group) => {
    const includeGroup = group.lead.join('\n').trim().length > 0 || group.items.length === 0
    return includeGroup ? [{ id: group.id, title: group.title }, ...group.items] : group.items
  })
  return targets.length ? [{ id: `sec-intro-${issueNumber}`, title: 'Episode intro' }, ...targets] : []
}
