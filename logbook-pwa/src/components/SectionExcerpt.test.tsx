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

  it('renders fenced code as escaped pre/code without resolving mentions inside it', () => {
    const html = renderToStaticMarkup(<SectionExcerpt section={{
      id: 'code', title: 'Code', items: [{ title: '', body: `Before\n\n\`\`\`json\n{"html":"<script>x</script>","author":"nostr:${npub}"}\n\`\`\`` }],
    }} profiles={new Map([[pubkey, { pubkey, name: 'Alice', picture: null }]])} />)
    expect(html).toContain('<pre class="section-excerpt__code"><code class="language-json">')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain(npub)
    expect(html).not.toContain('@Alice')
  })
})
