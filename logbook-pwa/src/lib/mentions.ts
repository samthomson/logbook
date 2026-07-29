import { nip19 } from 'nostr-tools'

/** Extract npubs from nostr:npub1… mentions outside fenced and inline code. */
export function extractMentionedNpubs(text: string): string[] {
  const out: string[] = []
  const codeSpans = /```[\s\S]*?```|`[^`\n]*`/g
  let cursor = 0

  for (const match of text.matchAll(codeSpans)) {
    extractFromProse(text.slice(cursor, match.index), out)
    cursor = match.index + match[0].length
  }
  extractFromProse(text.slice(cursor), out)
  return [...new Set(out)]
}

function extractFromProse(text: string, out: string[]): void {
  for (const match of text.matchAll(/nostr:npub1[02-9ac-hj-np-z]+/g)) {
    try {
      const decoded = nip19.decode(match[0].slice(6))
      if (decoded.type === 'npub') out.push(decoded.data as string)
    } catch { /* ignore malformed mentions */ }
  }
}
