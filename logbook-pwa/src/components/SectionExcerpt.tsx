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
function md(text: string, trim = true): string {
  const rendered = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>]/g, '')
  return trim ? rendered.trim() : rendered
}

/** Split prose into paragraphs on blank lines. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
}

type MarkdownBlock = { kind: 'prose' | 'code'; text: string; language?: string }

export function markdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const pattern = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > offset) blocks.push({ kind: 'prose', text: text.slice(offset, match.index) })
    blocks.push({ kind: 'code', language: match[1].trim() || undefined, text: match[2].replace(/\n$/, '') })
    offset = match.index! + match[0].length
  }
  if (offset < text.length) blocks.push({ kind: 'prose', text: text.slice(offset) })
  return blocks.filter((block) => block.text.trim())
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

/** Render inline code as code, leaving mentions and Markdown markers inside it literal. */
function renderInlineMarkdown(text: string, profiles: Map<string, Profile>) {
  return text.split(/(`[^`\n]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="section-excerpt__inline-code">{part.slice(1, -1)}</code>
    }
    return md(renderWithProfiles(part, profiles), false)
  })
}

export default function SectionExcerpt({ section, profiles = EMPTY_PROFILES }: Props) {
  const leadItems = section.items.filter((it) => !it.title)
  const named = section.items.filter((it) => it.title)
  const lead = leadItems.map((it) => it.body).join('\n\n').trim()

  const hasContent = lead || named.some((it) => it.body.trim())
  if (!hasContent) return null

  const renderBody = (body: string, key: string) => markdownBlocks(body).flatMap((block, index) => {
    if (block.kind === 'code') return [(
      <pre key={`${key}-code-${index}`} className="section-excerpt__code">
        <code className={block.language ? `language-${block.language}` : undefined}>{block.text}</code>
      </pre>
    )]
    return paragraphs(block.text).map((paragraph, paragraphIndex) => (
      <p key={`${key}-prose-${index}-${paragraphIndex}`} className="section-excerpt__para">
        {renderInlineMarkdown(paragraph, profiles)}
      </p>
    ))
  })

  // Always fully expanded — no read-more toggle (per product direction:
  // participants must read the full text before recording).
  return (
    <div className="section-excerpt">
      {lead && renderBody(lead, 'lead')}
      {named.map((item, i) => (
        <div key={i} className="section-excerpt__item">
          <h3 className="section-excerpt__item-title">{item.title}</h3>
          {item.body.trim() && renderBody(item.body, `item-${i}`)}
        </div>
      ))}
    </div>
  )
}
