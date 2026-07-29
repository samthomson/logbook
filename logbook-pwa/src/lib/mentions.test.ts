import { nip19 } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { extractMentionedNpubs } from './mentions'

const first = '1'.repeat(64)
const second = '2'.repeat(64)
const firstNpub = nip19.npubEncode(first)
const secondNpub = nip19.npubEncode(second)

describe('extractMentionedNpubs', () => {
  it('deduplicates prose mentions and ignores inline and fenced code', () => {
    const text = [
      `nostr:${firstNpub}`,
      `nostr:${firstNpub}`,
      `\`nostr:${secondNpub}\``,
      `\`\`\`json\n{"author":"nostr:${secondNpub}"}\n\`\`\``,
    ].join('\n')

    expect(extractMentionedNpubs(text)).toEqual([first])
  })
})
