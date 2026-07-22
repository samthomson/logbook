/**
 * WhitelistPanel — admin editor for kind 34201 whitelist events.
 *
 * Sections:
 *  1. Suggested — npubs mentioned in this issue's newsletter markdown,
 *     not yet whitelisted. One-tap add; nothing is auto-committed.
 *  2. This issue — per-issue contributors (d-tag logbook-wl-<N>).
 *  3. Standing roster — frequent contributors across all issues.
 *  4. Admins — visible to all admins; editable ONLY when logged in with the
 *     Compass key itself (publishWhitelist enforces this at signing too).
 *
 * Every mutation signs + publishes the relevant event immediately. Readers
 * only trust Compass-signed events, so a non-Compass admin sees an honest
 * notice instead of an editor that would silently no-op.
 */

import { useState, useEffect, useCallback } from 'react'
import type { NostrSigner } from '../types/nostr'
import {
  D_STANDING, D_ADMINS, D_ISSUE_WL, COMPASS_PUBKEY,
} from '../config'
import {
  fetchWhitelistEntries,
  publishWhitelist,
  extractMentionedPubkeys,
  normalizeToHex,
  type WhitelistEntry,
} from '../lib/whitelist'
import { nip19 } from 'nostr-tools'

interface Props {
  issueNumber: number
  issueMarkdown: string
  signer: NostrSigner
  pubkey: string
}

type ListKind = 'issue' | 'standing' | 'admins'

const D_TAG: Record<ListKind, (n: number) => string> = {
  issue: D_ISSUE_WL,
  standing: () => D_STANDING,
  admins: () => D_ADMINS,
}

export default function WhitelistPanel({ issueNumber, issueMarkdown, signer, pubkey }: Props) {
  const isCompass = pubkey === COMPASS_PUBKEY
  const [lists, setLists] = useState<Record<ListKind, WhitelistEntry[]>>({
    issue: [], standing: [], admins: [],
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<ListKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newInput, setNewInput] = useState<Record<ListKind, string>>({
    issue: '', standing: '', admins: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [issue, standing, admins] = await Promise.all([
        fetchWhitelistEntries(D_ISSUE_WL(issueNumber)),
        fetchWhitelistEntries(D_STANDING),
        fetchWhitelistEntries(D_ADMINS),
      ])
      setLists({ issue, standing, admins })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [issueNumber])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (kind: ListKind, entries: WhitelistEntry[]) => {
    setSaving(kind)
    setError(null)
    try {
      await publishWhitelist(D_TAG[kind](issueNumber), entries, signer)
      setLists((prev) => ({ ...prev, [kind]: entries }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(null)
    }
  }, [issueNumber, signer])

  const addEntry = useCallback((kind: ListKind, raw: string) => {
    const hex = normalizeToHex(raw.trim())
    if (!hex) {
      setError(`Not a valid npub or hex pubkey: ${raw.trim().slice(0, 24)}…`)
      return
    }
    const current = lists[kind]
    if (current.some((e) => e.pubkey === hex)) return // dedupe
    void save(kind, [...current, { pubkey: hex }])
    setNewInput((prev) => ({ ...prev, [kind]: '' }))
  }, [lists, save])

  const removeEntry = useCallback((kind: ListKind, pk: string) => {
    void save(kind, lists[kind].filter((e) => e.pubkey !== pk))
  }, [lists, save])

  // Suggested: mentioned in the newsletter, not on any list yet.
  const whitelisted = new Set([
    ...lists.issue.map((e) => e.pubkey),
    ...lists.standing.map((e) => e.pubkey),
  ])
  const suggested = extractMentionedPubkeys(issueMarkdown).filter((pk) => !whitelisted.has(pk))

  if (loading) {
    return <div className="wl-panel"><div className="spinner" aria-label="Loading whitelist" /></div>
  }

  return (
    <div className="wl-panel">
      <h3 className="wl-panel__title">Whitelist</h3>

      {!isCompass && (
        <p className="wl-panel__notice">
          You're an admin, but whitelist changes are only trusted when signed by the
          Compass key. Log in with the Compass login to edit these lists.
        </p>
      )}
      {error && <p className="wl-panel__error" role="alert">{error}</p>}

      {suggested.length > 0 && (
        <section className="wl-section">
          <h4 className="wl-section__title">
            Mentioned in this issue ({suggested.length})
          </h4>
          <ul className="wl-list">
            {suggested.map((pk) => (
              <li key={pk} className="wl-row">
                <span className="wl-row__npub" title={pk}>{nip19.npubEncode(pk).slice(0, 20)}…</span>
                <button
                  className="btn btn--xs btn--primary"
                  disabled={!isCompass || saving !== null}
                  onClick={() => void save('issue', [...lists.issue, { pubkey: pk }])}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
          <button
            className="btn btn--small btn--ghost"
            disabled={!isCompass || saving !== null}
            onClick={() =>
              void save('issue', [...lists.issue, ...suggested.map((pubkey) => ({ pubkey }))])
            }
          >
            Add all {suggested.length}
          </button>
        </section>
      )}

      <WhitelistSection
        title={`This issue (#${issueNumber})`}
        kind="issue"
        entries={lists.issue}
        input={newInput.issue}
        saving={saving === 'issue'}
        editable={isCompass}
        onInput={(v) => setNewInput((p) => ({ ...p, issue: v }))}
        onAdd={() => addEntry('issue', newInput.issue)}
        onRemove={(pk) => removeEntry('issue', pk)}
      />

      <WhitelistSection
        title="Standing roster (all issues)"
        kind="standing"
        entries={lists.standing}
        input={newInput.standing}
        saving={saving === 'standing'}
        editable={isCompass}
        onInput={(v) => setNewInput((p) => ({ ...p, standing: v }))}
        onAdd={() => addEntry('standing', newInput.standing)}
        onRemove={(pk) => removeEntry('standing', pk)}
      />

      <WhitelistSection
        title="Admins"
        kind="admins"
        entries={lists.admins}
        input={newInput.admins}
        saving={saving === 'admins'}
        editable={isCompass}
        onInput={(v) => setNewInput((p) => ({ ...p, admins: v }))}
        onAdd={() => addEntry('admins', newInput.admins)}
        onRemove={(pk) => removeEntry('admins', pk)}
        note="Admins see this panel and the episode review/lock tools. Only the Compass key can change this list."
      />
    </div>
  )
}

// ─── One list section ──────────────────────────────────────────────────────

interface SectionProps {
  title: string
  kind: ListKind
  entries: WhitelistEntry[]
  input: string
  saving: boolean
  editable: boolean
  note?: string
  onInput: (v: string) => void
  onAdd: () => void
  onRemove: (pk: string) => void
}

function WhitelistSection({
  title, entries, input, saving, editable, note, onInput, onAdd, onRemove,
}: SectionProps) {
  return (
    <section className="wl-section">
      <h4 className="wl-section__title">{title}</h4>
      {note && <p className="wl-section__note">{note}</p>}
      {entries.length === 0 ? (
        <p className="wl-section__empty">Empty.</p>
      ) : (
        <ul className="wl-list">
          {entries.map((e) => (
            <li key={e.pubkey} className="wl-row">
              <span className="wl-row__npub" title={e.pubkey}>
                {e.name ? `${e.name} — ` : ''}{nip19.npubEncode(e.pubkey).slice(0, 20)}…
              </span>
              <button
                className="btn btn--xs btn--ghost"
                disabled={!editable || saving}
                onClick={() => onRemove(e.pubkey)}
                aria-label={`Remove ${e.name ?? e.pubkey.slice(0, 8)}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="wl-add">
          <input
            className="auth-input wl-add__input"
            type="text"
            placeholder="npub1… or hex"
            value={input}
            onChange={(ev) => onInput(ev.target.value)}
            spellCheck={false}
          />
          <button
            className="btn btn--small btn--primary"
            disabled={saving || !input.trim()}
            onClick={onAdd}
          >
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      )}
    </section>
  )
}
