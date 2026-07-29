import { renderToStaticMarkup } from 'react-dom/server'
import { nip19 } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import SectionExcerpt from './SectionExcerpt'

const pubkey = '1'.repeat(64)
const npub = nip19.npubEncode(pubkey)

describe('SectionExcerpt', () => {
  it('uses parent-batched profiles without launching per-section lookups', () => {
    const html = renderToStaticMarkup(
      <SectionExcerpt
        section={{
          id: 'sec-performance-1',
          title: 'Performance',
          items: [{ title: '', body: `Built by nostr:${npub}.` }],
        }}
        profiles={new Map([[pubkey, { pubkey, name: 'Alice', picture: null }]])}
      />,
    )

    expect(html).toContain('Built by @Alice.')
    expect(html).not.toContain(npub)
  })
})
