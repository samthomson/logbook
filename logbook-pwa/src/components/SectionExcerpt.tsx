/**
 * SectionExcerpt — renders the newsletter text for one section.
 *
 * Shows the H2 section title, its lead paragraph (from items with empty
 * title or the first prose block), then each H3 sub-item as a titled
 * paragraph. This is the reading material participants scan before
 * recording their take.
 */

import type { IssueSection } from '../types/nostr'

interface Props {
  section: IssueSection
  expanded: boolean
  onToggle: () => void
}

/** Very small markdown-to-text: strip emphasis/links/images for excerpt view. */
function md(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .trim()
}

/** Split prose into paragraphs on blank lines. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
}

export default function SectionExcerpt({ section, expanded, onToggle }: Props) {
  // Lead prose items are title-less; there may be several of them.
  const leadItems = section.items.filter((it) => !it.title)
  const named = section.items.filter((it) => it.title)
  const lead = leadItems.map((it) => it.body).join('\n\n').trim()

  const hasContent = lead || named.some((it) => it.body.trim())
  const preview = expanded ? null : truncate(md(lead || named[0]?.body || ''), 220)

  // Section with no text at all — render nothing (just the notes)
  if (!hasContent) return null

  return (
    <div className="section-excerpt">
      {expanded ? (
        <div className="section-excerpt__full">
          {lead &&
            paragraphs(md(lead)).map((p, i) => (
              <p key={i} className="section-excerpt__para">{p}</p>
            ))}
          {named.map((item, i) => (
            <div key={i} className="section-excerpt__item">
              <h3 className="section-excerpt__item-title">{item.title}</h3>
              {item.body.trim() &&
                paragraphs(md(item.body)).map((p, j) => (
                  <p key={j} className="section-excerpt__para">{p}</p>
                ))}
            </div>
          ))}
          <button className="section-excerpt__toggle" onClick={onToggle}>
            Show less ▲
          </button>
        </div>
      ) : (
        <button className="section-excerpt__preview" onClick={onToggle}>
          {preview && <span className="section-excerpt__para">{preview}</span>}
          <span className="section-excerpt__toggle">Read section ▼</span>
        </button>
      )}
    </div>
  )
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`
}
