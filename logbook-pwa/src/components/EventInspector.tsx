/**
 * EventInspector — the Nostr event behind a page, shown plainly.
 *
 * Two views of the same thing: a short annotated summary of the fields that
 * decide what the app does with the event, then the raw JSON with those same
 * fields highlighted, so the summary and the wire format map onto each other.
 * No external viewer, no relay round trip — this is the event already loaded.
 */

import { useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import type { NostrEvent } from '../types/nostr'
import './EventInspector.css'

interface Props {
  event: NostrEvent
  /** Addressable coordinate (naddr) for a replaceable event. */
  address?: string
  kindLabel: string
  authorLabel: string
  onClose: () => void
}

type FieldKey = 'id' | 'pubkey' | 'kind' | 'created_at' | 'content' | 'sig' | 'd' | 'title'

const FIELD_NOTE: Record<FieldKey, string> = {
  id: 'Event id — the hash of everything else, so nothing here can change.',
  pubkey: 'Author key. The app only trusts this event because of this field.',
  kind: 'What kind of event this is.',
  created_at: 'When the author signed it.',
  content: 'The newsletter markdown. Its headings become the chapters.',
  sig: "The author's signature over the id.",
  d: 'Identifier. With kind and author it forms the address this page uses.',
  title: 'Title tag, shown at the top of the page.',
}

function classifyLine(line: string): FieldKey | null {
  if (/^\s*"id":/.test(line)) return 'id'
  if (/^\s*"pubkey":/.test(line)) return 'pubkey'
  if (/^\s*"kind":/.test(line)) return 'kind'
  if (/^\s*"created_at":/.test(line)) return 'created_at'
  if (/^\s*"content":/.test(line)) return 'content'
  if (/^\s*"sig":/.test(line)) return 'sig'
  if (/^\s*\[?\s*"d",/.test(line)) return 'd'
  if (/^\s*\[?\s*"title",/.test(line)) return 'title'
  return null
}

export default function EventInspector({ event, address, kindLabel, authorLabel, onClose }: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const json = JSON.stringify(event, null, 2)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text)
      .then(() => setCopied(label))
      .catch(() => setCopied('Copying is blocked in this browser'))
  }

  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? null
  const npub = nip19.npubEncode(event.pubkey)

  return (
    <div className="ev-overlay" onClick={onClose} role="presentation">
      <div
        className="ev"
        role="dialog"
        aria-modal="true"
        aria-label="Source event"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ev__head">
          <h2 className="ev__title">Source event</h2>
          <button className="btn btn--ghost btn--small" onClick={onClose}>Close</button>
        </header>

        <dl className="ev__summary">
          <div className="ev__field ev__field--kind">
            <dt>kind {event.kind}</dt>
            <dd>{kindLabel}</dd>
          </div>
          <div className="ev__field ev__field--pubkey">
            <dt>author</dt>
            <dd>
              {authorLabel}
              <code>{npub}</code>
            </dd>
          </div>
          {identifier && (
            <div className="ev__field ev__field--d">
              <dt>d tag</dt>
              <dd><code>{identifier}</code></dd>
            </div>
          )}
          <div className="ev__field ev__field--created_at">
            <dt>created_at</dt>
            <dd>{new Date(event.created_at * 1000).toLocaleString()}</dd>
          </div>
          {address && (
            <div className="ev__field ev__field--address">
              <dt>address</dt>
              <dd>
                <code>{address}</code>
                <button className="btn btn--ghost btn--xs" onClick={() => copy('Address copied', address)}>
                  Copy
                </button>
              </dd>
            </div>
          )}
        </dl>

        <div className="ev__toolbar">
          <p className="ev__hint">Highlighted lines below are the fields above.</p>
          <button className="btn btn--ghost btn--small" onClick={() => copy('Event JSON copied', json)}>
            Copy JSON
          </button>
        </div>
        {copied && <p className="ev__copied" role="status">{copied}</p>}

        <pre className="ev__json">
          {json.split('\n').map((line, index) => {
            const field = classifyLine(line)
            return (
              <span key={index} className={`ev__line ${field ? `ev__line--${field}` : ''}`}>
                {line}
                {field && <span className="ev__note"> ← {FIELD_NOTE[field]}</span>}
                {'\n'}
              </span>
            )
          })}
        </pre>
      </div>
    </div>
  )
}
