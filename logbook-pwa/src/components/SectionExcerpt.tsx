/**
 * SectionExcerpt — renders the newsletter text for one section/item.
 *
 * Shows the item's prose paragraphs, collapsed to a short preview. nostr:npub1…
 * mentions are resolved to kind-0 usernames (except inside code blocks / JSON
 * examples, which are left verbatim).
 */

import { useEffect, useMemo, useState } from 'react'
import { nip19 } from 'nostr-tools'
import type { IssueSection } from '../types/nostr'
import { fetchProfiles, type Profile } from '../lib/profiles'

interface Props {
  section: IssueSection
  expanded: boolean
  onToggle: () => void
}

/** Split markdown into code and non-code spans (``` fenced + `inline`). */
function splitCodeSpans(text: string): { text: string; code: boolean }[] {
  const parts: { text: string; code: boolean }[] = []
  const fence = /```[\s\S]*?```|`[^`\n]*`/g
  let last = 0
  for (const m of text.matchAll(fence)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), code: false })
    parts.push({ text: m[0], code: true })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), code: false })
  return parts
}

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

/** Extract npubs from nostr:npub1… mentions in non-code text. Exported for batch prefetch. */
export function extractMentionedNpubs(text: string): string[] {
  const out: string[] = []
  for (const span of splitCodeSpans(text)) {
    if (span.code) continue
    for (const m of span.text.matchAll(/nostr:npub1[02-9ac-hj-np-z]+/g)) {
      try {
        const decoded = nip19.decode(m[0].slice(6))
        if (decoded.type === 'npub') out.push(decoded.data as string)
      } catch { /* ignore malformed */ }
    }
  }
  return [...new Set(out)]
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

export default function SectionExcerpt({ section, expanded, onToggle }: Props) {
  const leadItems = section.items.filter((it) => !it.title)
  const named = section.items.filter((it) => it.title)
  const lead = leadItems.map((it) => it.body).join('\n\n').trim()

  const hasContent = lead || named.some((it) => it.body.trim())
  const fullText = [lead, ...named.map((it) => it.body)].join('\n\n')

  // Resolve mentioned npubs to profiles (kind 0)
  const npubs = useMemo(() => extractMentionedNpubs(fullText), [fullText])
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  useEffect(() => {
    if (!npubs.length) return
    let alive = true
    fetchProfiles(npubs).then((map) => {
      if (alive) setProfiles(map)
    })
    return () => {
      alive = false
    }
  }, [npubs])

  const preview = expanded ? null : truncate(md(renderWithProfiles(lead || named[0]?.body || '', profiles)), 220)

  if (!hasContent) return null

  return (
    <div className="section-excerpt">
      {expanded ? (
        <div className="section-excerpt__full">
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
