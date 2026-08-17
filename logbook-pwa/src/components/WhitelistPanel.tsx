/**
 * WhitelistPanel — editor for kind 34201 lists.
 *
 * Producers may add or remove contributors (this issue + standing). Only
 * Compass may change the producer list, so nobody can appoint themselves.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { NostrSigner } from '../types/nostr'
import { areRequestScopesCurrent, type LatestRequestGuard } from '../lib/latest-request'
import {
  D_STANDING, D_ADMINS, D_ISSUE_WL, COMPASS_PUBKEY,
} from '../config'
import {
  fetchWhitelistEntries,
  publishWhitelist,
  extractMentionedPubkeys,
  normalizeToHex,
  fetchProducerPubkeys,
  type WhitelistEntry,
} from '../lib/whitelist'
import { nip19 } from 'nostr-tools'
import { fetchProfiles, type Profile } from '../lib/profiles'

interface Props {
  issueNumber: number
  issueMarkdown: string
  signer: NostrSigner
  pubkey: string
  writeRequests: LatestRequestGuard
  capabilityRequests: LatestRequestGuard
  capabilityRequest: number | null
}

type ListKind = 'issue' | 'standing' | 'admins'

const D_TAG: Record<ListKind, (n: number) => string> = {
  issue: D_ISSUE_WL,
  standing: () => D_STANDING,
  admins: () => D_ADMINS,
}

export default function WhitelistPanel({
  issueNumber,
  issueMarkdown,
  signer,
  pubkey,
  writeRequests,
  capabilityRequests,
  capabilityRequest,
}: Props) {
  const capabilityRef = useRef({ issueNumber, pubkey, signer })
  capabilityRef.current = { issueNumber, pubkey, signer }
  const isCompass = pubkey.toLowerCase() === COMPASS_PUBKEY.toLowerCase()
  const [canEditContributors, setCanEditContributors] = useState(isCompass)
  const [lists, setLists] = useState<Record<ListKind, WhitelistEntry[]>>({
    issue: [], standing: [], admins: [],
  })
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
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
      const [issue, standing, admins, producers] = await Promise.all([
        fetchWhitelistEntries(D_ISSUE_WL(issueNumber)),
        fetchWhitelistEntries(D_STANDING),
        fetchWhitelistEntries(D_ADMINS),
        fetchProducerPubkeys(),
      ])
      setLists({ issue, standing, admins })
      setCanEditContributors(producers.has(pubkey.toLowerCase()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [issueNumber, pubkey])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (kind: ListKind, entries: WhitelistEntry[]) => {
    const request = writeRequests.begin()
    const capability = { issueNumber, pubkey, signer }
    const isActive = () => {
      const current = capabilityRef.current
      return areRequestScopesCurrent(
        capabilityRequests,
        capabilityRequest,
        writeRequests,
        request,
      )
        && current.issueNumber === capability.issueNumber
        && current.pubkey === capability.pubkey
        && current.signer === capability.signer
    }
    const assertActive = () => {
      if (!isActive()) throw new Error('Admin capability was revoked')
    }

    if (!isActive()) return
    setSaving(kind)
    setError(null)
    try {
      await publishWhitelist(D_TAG[kind](issueNumber), entries, signer, undefined, assertActive)
      if (!isActive()) return
      setLists((prev) => ({ ...prev, [kind]: entries }))
    } catch (err) {
      if (!isActive()) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (isActive()) setSaving(null)
    }
  }, [capabilityRequest, capabilityRequests, issueNumber, pubkey, signer, writeRequests])

  const addEntry = useCallback((kind: ListKind, raw: string) => {
    if (capabilityRequest === null || !capabilityRequests.isCurrent(capabilityRequest)) return
    const hex = normalizeToHex(raw.trim())
    if (!hex) {
      setError(`Not a valid npub or hex pubkey: ${raw.trim().slice(0, 24)}…`)
      return
    }
    const current = lists[kind]
    if (current.some((e) => e.pubkey === hex)) return // dedupe
    void save(kind, [...current, { pubkey: hex }])
    setNewInput((prev) => ({ ...prev, [kind]: '' }))
  }, [capabilityRequest, capabilityRequests, lists, save])

  const removeEntry = useCallback((kind: ListKind, pk: string) => {
    if (capabilityRequest === null || !capabilityRequests.isCurrent(capabilityRequest)) return
    void save(kind, lists[kind].filter((e) => e.pubkey !== pk))
  }, [capabilityRequest, capabilityRequests, lists, save])

  // Suggested: mentioned in the newsletter, not on any list yet.
  const whitelisted = useMemo(() => new Set([
    ...lists.issue.map((e) => e.pubkey),
    ...lists.standing.map((e) => e.pubkey),
  ]), [lists.issue, lists.standing])
  const suggested = useMemo(
    () => extractMentionedPubkeys(issueMarkdown).filter((pk) => !whitelisted.has(pk)),
    [issueMarkdown, whitelisted],
  )

  // Resolve every displayed identity from kind-0 metadata in one batch. Names
  // stored in a whitelist are advisory; profiles are the live display identity.
  useEffect(() => {
    const pubkeys = [...new Set([
      ...lists.issue.map((entry) => entry.pubkey),
      ...lists.standing.map((entry) => entry.pubkey),
      ...lists.admins.map((entry) => entry.pubkey),
      ...suggested,
    ])]
    if (!pubkeys.length) return
    let cancelled = false
    void fetchProfiles(pubkeys).then((fetched) => {
      if (!cancelled) setProfiles((previous) => new Map([...previous, ...fetched]))
    })
    return () => { cancelled = true }
  }, [lists, suggested])

  if (loading) {
    return <div className="wl-panel"><div className="spinner" aria-label="Loading whitelist" /></div>
  }

  return (
    <div className="wl-panel">
      <h3 className="wl-panel__title">Contributors</h3>

      {error && <p className="wl-panel__error" role="alert">{error}</p>}

      {suggested.length > 0 && (
        <section className="wl-section">
          <h4 className="wl-section__title">
            Mentioned in this issue ({suggested.length})
          </h4>
          <ul className="wl-list">
            {suggested.map((pk) => (
              <li key={pk} className="wl-row">
                <WhitelistIdentity pubkey={pk} profile={profiles.get(pk)} />
                <button
                  className="btn btn--xs btn--primary"
                  disabled={!canEditContributors || saving !== null}
                  onClick={() => void save('issue', [...lists.issue, { pubkey: pk }])}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
          <button
            className="btn btn--small btn--ghost"
            disabled={!canEditContributors || saving !== null}
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
        profiles={profiles}
        input={newInput.issue}
        saving={saving === 'issue'}
        editable={canEditContributors}
        onInput={(v) => setNewInput((p) => ({ ...p, issue: v }))}
        onAdd={() => addEntry('issue', newInput.issue)}
        onRemove={(pk) => removeEntry('issue', pk)}
      />

      <WhitelistSection
        title="Standing roster (all issues)"
        kind="standing"
        entries={lists.standing}
        profiles={profiles}
        input={newInput.standing}
        saving={saving === 'standing'}
        editable={canEditContributors}
        onInput={(v) => setNewInput((p) => ({ ...p, standing: v }))}
        onAdd={() => addEntry('standing', newInput.standing)}
        onRemove={(pk) => removeEntry('standing', pk)}
      />

      <WhitelistSection
        title="Producers"
        kind="admins"
        entries={lists.admins}
        profiles={profiles}
        input={newInput.admins}
        saving={saving === 'admins'}
        editable={isCompass}
        onInput={(v) => setNewInput((p) => ({ ...p, admins: v }))}
        onAdd={() => addEntry('admins', newInput.admins)}
        onRemove={(pk) => removeEntry('admins', pk)}
        note="Only Compass can change who is a producer."
      />
    </div>
  )
}

// ─── One list section ──────────────────────────────────────────────────────

interface SectionProps {
  title: string
  kind: ListKind
  entries: WhitelistEntry[]
  profiles: ReadonlyMap<string, Profile>
  input: string
  saving: boolean
  editable: boolean
  note?: string
  onInput: (v: string) => void
  onAdd: () => void
  onRemove: (pk: string) => void
}

function WhitelistSection({
  title, entries, profiles, input, saving, editable, note, onInput, onAdd, onRemove,
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
              <WhitelistIdentity pubkey={e.pubkey} profile={profiles.get(e.pubkey)} fallbackName={e.name} />
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

function WhitelistIdentity({
  pubkey,
  profile,
  fallbackName,
}: {
  pubkey: string
  profile?: Profile
  fallbackName?: string
}) {
  const name = profile?.name ?? fallbackName ?? null
  const npub = `${nip19.npubEncode(pubkey).slice(0, 16)}…`
  const initials = (name ?? pubkey.slice(0, 2)).slice(0, 2).toUpperCase()
  return (
    <span className="wl-identity" title={pubkey}>
      <span className="wl-identity__avatar" aria-hidden="true">
        {profile?.picture ? <img src={profile.picture} alt="" loading="lazy" /> : initials}
      </span>
      <span className="wl-identity__text">
        {name && <strong>{name}</strong>}
        <code>{npub}</code>
      </span>
    </span>
  )
}
