/**
 * EventInspector — the Nostr event behind a page, shown plainly.
 *
 * Two views of the same thing: a short annotated summary of the fields that
 * decide what the app does with the event, then the raw JSON with those same
 * fields highlighted, so the summary and the wire format map onto each other.
 * No external viewer, no relay round trip — this is the event already loaded.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { nip19 } from 'nostr-tools'
import { cutView, formatEventJson } from '../lib/event-inspect'
import { KINDS } from '../config'
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

function fieldNote(key: FieldKey, kind: number): string {
  if (key === 'content' && kind === KINDS.MANIFEST) {
    return 'The cut — chapters and the recording ids in each one.'
  }
  if (key === 'content' && kind === KINDS.COMPASS_ISSUE) {
    return 'The newsletter markdown. Its headings become the chapters.'
  }
  return {
    id: 'Event id — the hash of everything else, so nothing here can change.',
    pubkey: 'Author key. The app only trusts this event because of this field.',
    kind: 'What kind of event this is.',
    created_at: 'When the author signed it.',
    content: 'Event content.',
    sig: "The author's signature over the id.",
    d: 'Identifier. With kind and author it forms the address this page uses.',
    title: 'Title tag, shown at the top of the page.',
  }[key]
}

function classifyLine(line: string): FieldKey | null {
  if (/^ {2}"id":/.test(line)) return 'id'
  if (/^ {2}"pubkey":/.test(line)) return 'pubkey'
  if (/^ {2}"kind":/.test(line)) return 'kind'
  if (/^ {2}"created_at":/.test(line)) return 'created_at'
  if (/^ {2}"content":/.test(line)) return 'content'
  if (/^ {2}"sig":/.test(line)) return 'sig'
  if (/^ {6}"d",/.test(line)) return 'd'
  if (/^ {6}"title",/.test(line)) return 'title'
  return null
}

function statusLabel(status: string): string {
  if (status === 'published') return 'Published'
  if (status === 'cutting') return 'Locked'
  if (status === 'draft') return 'Open'
  return status
}

export default function EventInspector({ event, address, kindLabel, authorLabel, onClose }: Props) {
  const [copied, setCopied] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const json = formatEventJson(event)
  const cut = event.kind === KINDS.MANIFEST ? cutView(event) : null

  useEffect(() => {
    const y = window.scrollY
    dialogRef.current?.focus({ preventScroll: true })
    window.scrollTo(0, y)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = (label: string, text: string) => {
    if (!navigator.clipboard?.writeText) {
      setCopied('Copying is blocked in this browser')
      return
    }
    void navigator.clipboard.writeText(text)
      .then(() => setCopied(label))
      .catch(() => setCopied('Copying is blocked in this browser'))
  }

  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? null
  const npub = nip19.npubEncode(event.pubkey)

  return createPortal(
    <div className="ev-overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
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

        {cut && (
          <div className="ev__cut">
            <p className="ev__cut-status">{statusLabel(cut.status)}</p>
            {cut.chapters.map((chapter, index) => (
              <section key={`${chapter.title}:${index}`} className="ev__chapter">
                <h3 className="ev__chapter-title">{chapter.title}</h3>
                {chapter.inCut.length === 0 ? (
                  <p className="ev__hint">Nothing in the cut</p>
                ) : (
                  <ol className="ev__recordings">
                    {chapter.inCut.map((id, index) => (
                      <li key={id}>
                        <span className="ev__rec-n">{index + 1}</span>
                        <code>{id}</code>
                      </li>
                    ))}
                  </ol>
                )}
                {chapter.leftOut.length > 0 && (
                  <>
                    <p className="ev__hint">Left out</p>
                    <ul className="ev__recordings ev__recordings--out">
                      {chapter.leftOut.map((id) => (
                        <li key={id}><code>{id}</code></li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            ))}
          </div>
        )}

        <div className="ev__toolbar">
          <p className="ev__hint">
            {cut ? 'Same cut as JSON below. content is expanded, not escaped.' : 'Highlighted lines below are the fields above.'}
          </p>
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
                {field && <span className="ev__note"> ← {fieldNote(field, event.kind)}</span>}
                {'\n'}
              </span>
            )
          })}
        </pre>
      </div>
    </div>,
    document.body,
  )
}
