/**
 * SectionExcerpt — renders the newsletter text for one section/item.
 *
 * Shows the item's prose paragraphs, collapsed to a short preview. nostr:npub1…
 * mentions are resolved to kind-0 usernames (except inside code blocks / JSON
 * examples, which are left verbatim).
 */

import { nip19 } from 'nostr-tools'
import type { IssueSection } from '../types/nostr'
import type { Profile } from '../lib/profiles'

interface Props {
  section: IssueSection
  profiles?: Map<string, Profile>
}

const EMPTY_PROFILES = new Map<string, Profile>()


/** Very small markdown-to-text: strip emphasis/links/images for excerpt view. */
function md(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>]/g, '')
    .trim()
}

/** Split prose into paragraphs on blank lines. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
}


/** Replace nostr:npub mentions with display names where known. */
function renderWithProfiles(text: string, profiles: Map<string, Profile>): string {
  return text.replace(/nostr:npub1[02-9ac-hj-np-z]+/g, (token) => {
    try {
      const decoded = nip19.decode(token.slice(6))
      if (decoded.type === 'npub') {
        const p = profiles.get(decoded.data as string)
        if (p?.name) return `@${p.name}`
      }
    } catch { /* fall through */ }
    return token
  })
}

export default function SectionExcerpt({ section, profiles = EMPTY_PROFILES }: Props) {
  const leadItems = section.items.filter((it) => !it.title)
  const named = section.items.filter((it) => it.title)
  const lead = leadItems.map((it) => it.body).join('\n\n').trim()

  const hasContent = lead || named.some((it) => it.body.trim())
  if (!hasContent) return null

  // Always fully expanded — no read-more toggle (per product direction:
  // participants must read the full text before recording).
  return (
    <div className="section-excerpt">
      {lead &&
        paragraphs(md(renderWithProfiles(lead, profiles))).map((p, i) => (
          <p key={i} className="section-excerpt__para">{p}</p>
        ))}
      {named.map((item, i) => (
        <div key={i} className="section-excerpt__item">
          <h3 className="section-excerpt__item-title">{item.title}</h3>
          {item.body.trim() &&
            paragraphs(md(renderWithProfiles(item.body, profiles))).map((p, j) => (
              <p key={j} className="section-excerpt__para">{p}</p>
            ))}
        </div>
      ))}
    </div>
  )
}
