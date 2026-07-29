/**
 * IssueTimeline — dense podcast preparation surface.
 *
 * Per project item: excerpt (expanded, edge-to-edge) → bubbles → one inline
 * record row. Tapping the mic icon starts recording in place; tapping stop
 * publishes and the bubble appears right where the row was. No boxes, no
 * modal flows. Reply ↩ opens the same inline row under that bubble.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import VoiceBubble from './VoiceBubble'
import UploadBubble from './UploadBubble'
import InlineRecorder, { type InlineRecordingResult } from './InlineRecorder'
import SectionExcerpt from './SectionExcerpt'
import type {
  CompassIssue,
  Segment,
  IssueSection,
  IssueSectionItem,
  NostrSigner,
  NostrEvent,
} from '../types/nostr'
import { fetchSegmentsForIssue, mergeSegmentEventGroups, parseSegment, publishSegment, fetchTranscripts, selectTrustedSegmentEvents } from '../lib/segment'
import { fetchManifest } from '../lib/manifest'
import { orderTimelineSegments } from '../lib/timeline-order'
import { saveCachedIssue } from '../lib/issue-cache'
import { extractMentionedNpubs } from '../lib/mentions'
import { uploadBlob } from '../lib/blossom'
import { collectEpisodeNotes } from '../lib/community-notes'
import { computeSeedOrder } from '../lib/ordering'
import { PlaybackProvider } from '../lib/playback'
import { fetchProfiles, type Profile } from '../lib/profiles'
import { getPool } from '../lib/pool'
import { deleteDraft, draftBelongsTo, listDrafts, saveDraft, selectDraftsForPrincipal, type RecordingDraft } from '../lib/drafts'
import type { Filter } from 'nostr-tools'
import { BLOSSOM_SERVERS, DEFAULT_RELAYS, KINDS, ISSUE_PREFIX } from '../config'
import type { LatestRequestGuard } from '../lib/latest-request'
import { formatDuration } from '../lib/utils'

interface Props {
  issue: CompassIssue
  signer: NostrSigner | null
  myPubkey: string | null
  canRecord: boolean
  capabilityRequests: LatestRequestGuard
  capabilityRequest: number | null
  cachedSegments?: [string, NostrEvent[]][]
}

interface SectionState {
  segments: Segment[]
  order: string[]
  loading: boolean
  error: string | null
}

interface RecordTarget {
  sectionId: string
  respondingTo?: string
}

interface PendingTake {
  ownerPubkey: string
  target: RecordTarget
  result: InlineRecordingResult
  descriptor: import('../types/nostr').BlobDescriptor | null
  draftId: string
}

interface RecordingSection {
  id: string
  title: string
  item?: IssueSectionItem
}

function recordingSections(issue: CompassIssue): { group: IssueSection; targets: RecordingSection[] }[] {
  return issue.sections.map((group) => {
    const named = group.items.filter((it) => it.title && it.id)
    const targets: RecordingSection[] = named.map((it) => ({ id: it.id!, title: it.title, item: it }))
    const lead = group.items.find((it) => !it.title)
    if (lead?.body.trim() || targets.length === 0) {
      targets.unshift({ id: group.id, title: group.title, item: lead })
    }
    return { group, targets }
  })
}

export default function IssueTimeline({
  issue,
  signer,
  myPubkey,
  canRecord,
  capabilityRequests,
  capabilityRequest,
  cachedSegments = [],
}: Props) {
  const recordingEnabled = canRecord && signer !== null
  const publishCapabilityRef = useRef({ issueNumber: issue.issueNumber, myPubkey, recordingEnabled, signer })
  publishCapabilityRef.current = { issueNumber: issue.issueNumber, myPubkey, recordingEnabled, signer }
  const [sections, setSections] = useState<Map<string, SectionState>>(new Map())
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [pendingDrafts, setPendingDrafts] = useState<RecordingDraft[]>([])
  const [publishingDraftIds, setPublishingDraftIds] = useState<Set<string>>(new Set())
  const [uploadStages, setUploadStages] = useState<Map<string, string>>(new Map())
  const [justPublished, setJustPublished] = useState<Set<string>>(new Set())
  const [newSegmentIds, setNewSegmentIds] = useState<Set<string>>(new Set())
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const [transcripts, setTranscripts] = useState<Map<string, string>>(new Map())
  const [refreshGeneration, setRefreshGeneration] = useState(0)
  const knownIdsRef = useRef<Set<string>>(new Set())
  const groupedEventsRef = useRef<Map<string, NostrEvent[]>>(new Map())
  const cacheWriteRef = useRef<Promise<void>>(Promise.resolve())
  const mountedAtRef = useRef<number>(Math.floor(Date.now() / 1000))
  const loadedIssueRef = useRef<number | null>(null)

  const queueCacheWrite = useCallback((snapshotIssue: CompassIssue, grouped: [string, NostrEvent[]][]) => {
    const snapshot = grouped.map(([sectionId, events]) => [sectionId, [...events]] as [string, NostrEvent[]])
    cacheWriteRef.current = cacheWriteRef.current
      .then(() => saveCachedIssue(snapshotIssue, snapshot))
      .catch((error) => console.warn('Unable to cache public timeline:', error))
  }, [])

  const groups = useMemo(() => recordingSections(issue), [issue])
  const allTargets = useMemo(() => groups.flatMap((g) => g.targets), [groups])

  // Prefetch mention profiles (one batched query)
  useEffect(() => {
    const fullText = issue.sections.flatMap((s) => s.items.map((it) => it.body)).join('\n\n')
    const npubs = extractMentionedNpubs(fullText)
    if (!npubs.length) return
    let alive = true
    fetchProfiles(npubs).then((map) => {
      if (alive) setProfiles((prev) => new Map([...prev, ...map]))
    })
    return () => { alive = false }
  }, [issue])

  // Load all segments in one query
  useEffect(() => {
    let mounted = true
    const cachedGrouped = new Map(cachedSegments)
    const refreshingSameIssue = loadedIssueRef.current === issue.issueNumber
    loadedIssueRef.current = issue.issueNumber
    if (!refreshingSameIssue) {
      knownIdsRef.current.clear()
      groupedEventsRef.current = new Map(cachedSegments.map(([sectionId, events]) => [sectionId, [...events]]))
      for (const events of groupedEventsRef.current.values()) {
        for (const event of events) knownIdsRef.current.add(event.id)
      }
    }
    // Persist the parsed newsletter immediately on issue changes. A retry must
    // not overwrite a fresher relay snapshot with the original cached props.
    if (!refreshingSameIssue) {
      queueCacheWrite(issue, cachedSegments)
    }
    setSections((current) => {
      if (refreshingSameIssue && current.size > 0) {
        return new Map([...current].map(([id, state]) => [id, { ...state, loading: true, error: null }]))
      }
      const next = new Map<string, SectionState>()
      for (const t of allTargets) {
        const cached = (cachedGrouped.get(t.id) ?? []).flatMap((event) => {
          const segment = parseSegment(event)
          return segment ? [segment] : []
        })
        next.set(t.id, { segments: cached, order: computeSeedOrder(cached), loading: cached.length === 0, error: null })
      }
      return next
    })

    Promise.all([fetchSegmentsForIssue(`${ISSUE_PREFIX}-${issue.issueNumber}`), fetchManifest(issue.issueNumber).catch(() => null)])
      .then(([grouped, manifest]) => {
        if (!mounted) return
        const mergedGrouped = mergeSegmentEventGroups(grouped, [...groupedEventsRef.current.values()].flat())
        groupedEventsRef.current = mergedGrouped
        const allParsed: Segment[] = []
        const orphaned: Segment[] = []
        setSections(() => {
          const next = new Map<string, SectionState>()
          const knownIds = new Set(allTargets.map((t) => t.id))
          for (const t of allTargets) {
            const events = mergedGrouped.get(t.id) ?? []
            const parsed = events.flatMap((e) => {
              const s = parseSegment(e)
              return s ? [s] : []
            })
            for (const seg of parsed) {
              knownIdsRef.current.add(seg.event.id)
              allParsed.push(seg)
            }
            const manifestSection = manifest?.content.sections.find((section) => section.id === t.id)
            next.set(t.id, {
              segments: parsed,
              order: manifestSection
                ? orderTimelineSegments(parsed, manifestSection.order, manifestSection.excluded)
                : computeSeedOrder(parsed),
              loading: false,
              error: null,
            })
          }
          // Segments whose section tag no longer matches any item (old ID
          // formats) — surface them under the first group so nothing is lost
          for (const [secId, events] of mergedGrouped) {
            if (knownIds.has(secId)) continue
            for (const e of events) {
              const s = parseSegment(e)
              if (s) {
                knownIdsRef.current.add(s.event.id)
                orphaned.push(s)
              }
            }
          }
          if (orphaned.length && allTargets.length) {
            const first = next.get(allTargets[0].id)
            if (first) {
              const merged = [...first.segments, ...orphaned]
              next.set(allTargets[0].id, { ...first, segments: merged, order: computeSeedOrder(merged) })
              allParsed.push(...orphaned)
            }
          }
          return next
        })
        queueCacheWrite(issue, [...mergedGrouped.entries()])
        if (allParsed.length) {
          fetchProfiles(allParsed.map((s) => s.event.pubkey)).then((map) => {
            if (!mounted) return
            setProfiles((prev) => new Map([...prev, ...map]))
          })
          // Fetch cryptographically bound transcript companions for verified segments.
          fetchTranscripts(allParsed).then((map) => {
            if (!mounted) return
            setTranscripts((prev) => {
              const next = new Map(prev)
              for (const [id, transcript] of map) next.set(id, transcript.text)
              return next
            })
          })
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return
        const message = err instanceof Error ? err.message : String(err)
        setSections((prev) => {
          const next = new Map(prev)
          for (const t of allTargets) {
            const current = next.get(t.id)
            next.set(t.id, current
              ? { ...current, loading: false, error: message }
              : { segments: [], order: [], loading: false, error: message })
          }
          return next
        })
      })

    return () => { mounted = false }
  }, [allTargets, cachedSegments, issue, queueCacheWrite, refreshGeneration])

  // Live subscription
  useEffect(() => {
    if (!allTargets.length) return
    const pool = getPool()
    const issueId = `${ISSUE_PREFIX}-${issue.issueNumber}`
    const targetIds = new Set(allTargets.map((t) => t.id))
    const sub = pool.subscribeMany(
      DEFAULT_RELAYS,
      { kinds: [KINDS.SEGMENT], '#t': [issueId], since: mountedAtRef.current } as Filter,
      {
        onevent(event: NostrEvent) {
          if (loadedIssueRef.current !== issue.issueNumber) return
          const trustedEvent = selectTrustedSegmentEvents([event], issueId, BLOSSOM_SERVERS)[0]
          if (!trustedEvent || knownIdsRef.current.has(trustedEvent.id)) return
          knownIdsRef.current.add(trustedEvent.id)
          const seg = parseSegment(trustedEvent)
          if (!seg) return
          groupedEventsRef.current = mergeSegmentEventGroups(groupedEventsRef.current, [trustedEvent])
          queueCacheWrite(issue, [...groupedEventsRef.current.entries()])
          const destId = targetIds.has(seg.sectionId) ? seg.sectionId : allTargets[0]?.id
          if (!destId) return
          setSections((prev) => {
            const next = new Map(prev)
            const cur = next.get(destId)
            if (!cur) return prev
            const newSegments = [...cur.segments, seg]
            const newOrder = computeSeedOrder(newSegments)
            next.set(destId, { ...cur, segments: newSegments, order: newOrder })
            return next
          })
          setNewSegmentIds((prev) => new Set([...prev, event.id]))
          fetchProfiles([event.pubkey]).then((map) => {
            setProfiles((prev) => new Map([...prev, ...map]))
          })
        },
      },
    )
    return () => sub.close()
  }, [allTargets, issue, queueCacheWrite])

  const handleReply = useCallback((segment: Segment) => {
    // Resolve the section where this segment is actually displayed — relay
    // data may carry legacy section ids (e.g. old H2-style slugs) that don't
    // match any current per-item target id.
    let home = segment.sectionId
    if (!sections.has(home)) {
      for (const [id, st] of sections) {
        if (st.segments.some((s) => s.event.id === segment.event.id)) { home = id; break }
      }
    }
    setRecordTarget({ sectionId: home, respondingTo: segment.event.id })
  }, [sections])

  const pendingRef = useRef<Map<string, PendingTake>>(new Map())
  const activePublishAttemptsRef = useRef<Map<string, symbol>>(new Map())

  useEffect(() => {
    const activePublishAttempts = activePublishAttemptsRef.current
    activePublishAttempts.clear()
    setPublishingDraftIds(new Set())
    setUploadStages(new Map())
    setPublishError(null)
    // Recorder targets belong to one issue/identity capability. Never carry a
    // hidden or active target across issue, signer, or authorization changes.
    setRecordTarget(null)
    return () => { activePublishAttempts.clear() }
  }, [issue.issueNumber, myPubkey, recordingEnabled, signer])

  const handleRecorded = useCallback(
    async (result: InlineRecordingResult, target: RecordTarget, retryDraftId?: string) => {
      if (!recordingEnabled || !signer || !myPubkey) return
      const ownerPubkey = myPubkey
      const resumablePending = retryDraftId ? pendingRef.current.get(retryDraftId) : undefined
      const draftId = resumablePending?.draftId ?? crypto.randomUUID()
      if (activePublishAttemptsRef.current.has(draftId)) return

      const hasVerifiedCapability = capabilityRequest !== null
        && capabilityRequests.isCurrent(capabilityRequest)
      if (!hasVerifiedCapability) {
        // A same-tab access snapshot may expose the recorder immediately, but
        // it never authorizes signer/network work. Keep the take owner/issue
        // bound in IndexedDB until a verified refresh permits explicit resume.
        const draft: RecordingDraft = {
          id: draftId,
          issueNumber: issue.issueNumber,
          ownerPubkey,
          target: { sectionId: target.sectionId, respondingTo: target.respondingTo ?? null },
          blob: result.blob,
          duration: result.duration,
          waveform: result.waveform,
          descriptor: resumablePending?.descriptor ?? null,
          updatedAt: Date.now(),
        }
        pendingRef.current.set(draftId, {
          ownerPubkey,
          target,
          result,
          descriptor: draft.descriptor,
          draftId,
        })
        setPendingDrafts((current) => [draft, ...current.filter((item) => item.id !== draftId)])
        await saveDraft(draft).catch((error) => console.warn('Unable to persist recording draft:', error))
        setPublishError('Recording saved locally. Retry after contributor access finishes refreshing.')
        return
      }

      const attemptToken = Symbol(draftId)
      activePublishAttemptsRef.current.set(draftId, attemptToken)

      const isCapabilityCurrent = () => {
        const current = publishCapabilityRef.current
        return capabilityRequest !== null
          && capabilityRequests.isCurrent(capabilityRequest)
          && current.recordingEnabled
          && current.signer === signer
          && current.myPubkey === myPubkey
          && current.issueNumber === issue.issueNumber
      }
      const isPublishingActive = () => {
        return activePublishAttemptsRef.current.get(draftId) === attemptToken && isCapabilityCurrent()
      }
      const assertPublishingActive = () => {
        if (!isPublishingActive()) {
          throw new Error('Publishing authorization was revoked.')
        }
      }
      if (!isPublishingActive()) {
        if (activePublishAttemptsRef.current.get(draftId) === attemptToken) {
          activePublishAttemptsRef.current.delete(draftId)
        }
        return
      }

      const setStage = (stage: string) => {
        if (!isPublishingActive()) return
        setUploadStages((current) => {
          const next = new Map(current)
          next.set(draftId, stage)
          return next
        })
      }
      const persistDraft = async (descriptor: import('../types/nostr').BlobDescriptor | null) => {
        assertPublishingActive()
        const draft: RecordingDraft = {
          id: draftId,
          issueNumber: issue.issueNumber,
          ownerPubkey,
          target: { sectionId: target.sectionId, respondingTo: target.respondingTo ?? null },
          blob: result.blob,
          duration: result.duration,
          waveform: result.waveform,
          descriptor,
          updatedAt: Date.now(),
        }
        // Render each take before IndexedDB finishes. The map allows another
        // recording to be saved while this one waits on Amber or Blossom.
        pendingRef.current.set(draftId, { ownerPubkey, target, result, descriptor, draftId })
        setPendingDrafts((current) => [draft, ...current.filter((item) => item.id !== draftId)])
        try {
          await saveDraft(draft)
        } catch (error) {
          // Storage can be unavailable in private browsing; publishing remains
          // available, but the user gets an explicit warning if it later fails.
          console.warn('Unable to persist recording draft:', error)
        }
        assertPublishingActive()
      }
      try {
        assertPublishingActive()
        setPublishingDraftIds((current) => new Set([...current, draftId]))
        setPublishError(null)
        setStage('Preparing upload')
        await persistDraft(resumablePending?.descriptor ?? null)
        assertPublishingActive()
        // Reuse a prior attempt's descriptor if the upload already succeeded —
        // otherwise the blob gets re-uploaded and the old one is orphaned.
        let descriptor = resumablePending?.descriptor ?? null
        if (!descriptor) {
          const up = await uploadBlob(
            result.blob,
            signer,
            ownerPubkey,
            undefined,
            setStage,
            assertPublishingActive,
          )
          descriptor = up.descriptor
          await persistDraft(descriptor)
          if (up.mirrorFailures.length) {
            console.warn('Some mirrors failed:', up.mirrorFailures)
          }
        }
        assertPublishingActive()
        pendingRef.current.set(draftId, { ownerPubkey, target, result, descriptor, draftId })
        setStage('Publishing to relays')

        const event = await publishSegment({
          signer,
          expectedPubkey: ownerPubkey,
          blob: descriptor,
          duration: result.duration,
          waveform: result.waveform,
          sectionId: target.sectionId,
          issueNumber: issue.issueNumber,
          respondingTo: target.respondingTo,
          assertActive: assertPublishingActive,
        })
        assertPublishingActive()
        // Publication completed while this capability was current. Clear only
        // this operation's in-memory draft synchronously; any awaited cleanup
        // after this point must re-check capability before touching UI again.
        pendingRef.current.delete(draftId)
        setPendingDrafts((current) => current.filter((item) => item.id !== draftId))
        await deleteDraft(draftId).catch((error) => console.warn('Unable to remove published recording draft:', error))
        if (!isPublishingActive()) return
        const newSeg = parseSegment(event)
        if (newSeg) {
          knownIdsRef.current.add(newSeg.event.id)
          setSections((prev) => {
            const next = new Map(prev)
            const cur = next.get(target.sectionId)
            if (cur) {
              const newSegments = [...cur.segments, newSeg]
              const newOrder = computeSeedOrder(newSegments)
              next.set(target.sectionId, { ...cur, segments: newSegments, order: newOrder })
            }
            return next
          })
          // Subtle published indicator on the new bubble
          setJustPublished((prev) => new Set([...prev, newSeg.event.id]))
          setTimeout(() => {
            if (!isCapabilityCurrent()) return
            setJustPublished((prev) => {
              const next = new Set(prev)
              next.delete(newSeg.event.id)
              return next
            })
          }, 3000)
        }
      } catch (err) {
        if (isPublishingActive()) {
          // Keep the pending recording + descriptor so a current contributor can
          // retry without re-recording or re-uploading. Stale sessions stay silent.
          console.error('Publish failed:', err)
          const msg = err instanceof Error ? err.message : String(err)
          setPublishError(`Publish failed — recording NOT lost, resume the saved upload to retry. (${msg.slice(0, 160)})`)
        }
      } finally {
        // A revoked attempt may settle after the same draft was restored and
        // retried. Only the exact attempt that still owns this draft may clear
        // its active marker or UI stage.
        if (activePublishAttemptsRef.current.get(draftId) === attemptToken) {
          activePublishAttemptsRef.current.delete(draftId)
          setPublishingDraftIds((current) => {
            const next = new Set(current)
            next.delete(draftId)
            return next
          })
          setUploadStages((current) => {
            const next = new Map(current)
            next.delete(draftId)
            return next
          })
        }
      }
    },
    [capabilityRequest, capabilityRequests, issue.issueNumber, myPubkey, recordingEnabled, signer],
  )

  // Restore every take owned by this principal. They are never published
  // automatically; each remains durable and independently resumable.
  useEffect(() => {
    pendingRef.current.clear()
    setPendingDrafts([])
    let alive = true
    listDrafts(issue.issueNumber).then((drafts) => {
      if (!alive) return
      const visible = selectDraftsForPrincipal(drafts, myPubkey)
      for (const draft of visible) {
        if (!draftBelongsTo(draft, myPubkey)) continue
        const target: RecordTarget = {
          sectionId: draft.target.sectionId,
          respondingTo: draft.target.respondingTo ?? undefined,
        }
        pendingRef.current.set(draft.id, {
          ownerPubkey: draft.ownerPubkey,
          target,
          result: { blob: draft.blob, duration: draft.duration, waveform: draft.waveform },
          descriptor: draft.descriptor,
          draftId: draft.id,
        })
      }
      setPendingDrafts(visible)
    }).catch((error) => console.warn('Unable to restore recording draft:', error))
    return () => { alive = false }
  }, [issue.issueNumber, myPubkey])

  const retryPendingDraft = useCallback((draftId: string) => {
    const pending = pendingRef.current.get(draftId)
    if (!pending || pending.ownerPubkey !== myPubkey || activePublishAttemptsRef.current.has(draftId)) return
    void handleRecorded(pending.result, pending.target, draftId)
  }, [handleRecorded, myPubkey])

  const discardPendingDraft = useCallback((draftId: string) => {
    const draft = pendingDrafts.find((item) => item.id === draftId)
    if (
      capabilityRequest === null
      || !capabilityRequests.isCurrent(capabilityRequest)
      || !draft
      || !draftBelongsTo(draft, myPubkey)
      || activePublishAttemptsRef.current.has(draftId)
    ) return
    pendingRef.current.delete(draftId)
    setPendingDrafts((current) => current.filter((item) => item.id !== draftId))
    void deleteDraft(draftId).catch((error) => console.warn('Unable to discard recording draft:', error))
  }, [capabilityRequest, capabilityRequests, myPubkey, pendingDrafts])

  const episodeNotes = useMemo(
    () => collectEpisodeNotes([...sections.values()].map((state) => state.segments)),
    [sections],
  )
  const relayError = useMemo(
    () => [...sections.values()].find((state) => state.error)?.error ?? null,
    [sections],
  )
  const hasAvailableSegments = useMemo(
    () => [...sections.values()].some((state) => state.segments.length > 0),
    [sections],
  )

  const queue = useMemo(() => {
    const out: Segment[] = []
    for (const target of allTargets) {
      const state = sections.get(target.id)
      if (!state) continue
      for (const id of state.order) {
        const seg = state.segments.find((s) => s.event.id === id)
        if (seg) out.push(seg)
      }
    }
    return out
  }, [allTargets, sections])

  // Opening paragraph = prose before the first H2 in the newsletter body
  const leadProse = useMemo(() => {
    const content = issue.event.content
    const idx = content.indexOf('\n## ')
    const head = (idx === -1 ? content : content.slice(0, idx))
      .replace(/^#\s+.*\n/, '') // drop the H1 title line itself
      .trim()
    return head
  }, [issue.event.content])

  return (
    <PlaybackProvider segments={queue}>
      <main className="timeline timeline--dense">
        <header className="timeline__issue-head">
          <h1 className="timeline__issue-title">
            Compass #{issue.issueNumber}
            <span className="timeline__issue-date">
              {new Date(issue.event.created_at * 1000).toLocaleDateString([], {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </span>
          </h1>
          {leadProse && <SectionExcerpt section={{ id: '__lead', title: '', items: [{ title: '', body: leadProse }] }} profiles={profiles} />}
        </header>
        {publishError && (
          <div className="timeline__publish-error" role="alert">{publishError}</div>
        )}
        {relayError && (
          <div className="notice notice--warning notice--episode" role="status">
            <span>
              {hasAvailableSegments
                ? 'Showing saved voice notes — relays unavailable.'
                : 'Voice notes unavailable — relays could not be reached.'}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setRefreshGeneration((generation) => generation + 1)}
            >
              Retry
            </button>
          </div>
        )}
        {episodeNotes.length > 0 && (
          <section className="timeline__group timeline__community" aria-label="Voice notes in this episode">
            <h2 className="timeline__group-title">Voice notes in this episode · {episodeNotes.length}</h2>
            <div className="timeline__community-links">
              {episodeNotes.map((seg, index) => {
                const author = profiles.get(seg.event.pubkey)?.name ?? seg.event.pubkey.slice(0, 8)
                const duration = formatDuration(seg.audio.duration)
                return (
                  <a
                    key={seg.event.id}
                    href={`#voice-note-${seg.event.id}`}
                    aria-label={`Voice note ${index + 1} from ${author}, ${duration}`}
                  >
                    {index + 1}. {author} · {duration}
                  </a>
                )
              })}
            </div>
          </section>
        )}
        {groups.map(({ group, targets }) => (
          <div key={group.id} className="timeline__group">
            <h2 className="timeline__group-title">{group.title}</h2>

            {targets.map((target) => {
              const state = sections.get(target.id)
              const isRecordingHere = recordTarget?.sectionId === target.id
              const isPlainRecordingHere = isRecordingHere && !recordTarget?.respondingTo
              const canShowPlainRecorder = recordTarget === null || isPlainRecordingHere

              return (
                <section key={target.id} className="timeline__section">
                  {target.item && (
                    <SectionExcerpt section={{ id: target.id, title: target.title, items: [target.item] }} profiles={profiles} />
                  )}

                  {(state?.order.length ?? 0) > 0 && (
                    <div className="timeline__notes">
                      {state!.order.map((id) => {
                        const seg = state!.segments.find((s) => s.event.id === id)
                        if (!seg) return null
                        const isReplyingHere =
                          recordTarget?.sectionId === target.id && recordTarget?.respondingTo === seg.event.id
                        return (
                          <div key={id} className="timeline__note">
                            <VoiceBubble
                              segment={seg}
                              profile={profiles.get(seg.event.pubkey)}
                              transcript={transcripts.get(id)}
                              onReply={recordingEnabled && recordTarget === null ? handleReply : undefined}
                              isWhitelisted={recordingEnabled}
                              isNew={newSegmentIds.has(id)}
                              isOwn={seg.event.pubkey === myPubkey}
                              justPublished={justPublished.has(id)}
                            />
                            {recordingEnabled && isReplyingHere && (
                              <InlineRecorder
                                onRecorded={(result) => {
                                  setRecordTarget((current) => current?.respondingTo === seg.event.id ? null : current)
                                  void handleRecorded(result, { sectionId: target.id, respondingTo: seg.event.id })
                                }}
                                onCancel={() => setRecordTarget((current) => (
                                  current?.sectionId === target.id && current.respondingTo === seg.event.id ? null : current
                                ))}
                                autoStart
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {pendingDrafts
                    .filter((draft) => draft.target.sectionId === target.id)
                    .map((draft) => (
                      <UploadBubble
                        key={draft.id}
                        draft={draft}
                        stage={uploadStages.get(draft.id) ?? null}
                        publishing={publishingDraftIds.has(draft.id)}
                        canResume={recordingEnabled && draftBelongsTo(draft, myPubkey)}
                        canDiscard={recordingEnabled && draftBelongsTo(draft, myPubkey)}
                        onResume={() => retryPendingDraft(draft.id)}
                        onDiscard={() => discardPendingDraft(draft.id)}
                      />
                    ))}

                  {recordingEnabled && canShowPlainRecorder && (
                    <div className="timeline__recrow">
                      <InlineRecorder
                        onRecorded={(result) => {
                          setRecordTarget((current) => current?.sectionId === target.id && !current.respondingTo ? null : current)
                          void handleRecorded(result, { sectionId: target.id })
                        }}
                        onCancel={() => setRecordTarget((current) => current?.sectionId === target.id && !current.respondingTo ? null : current)}
                        onArm={() => setRecordTarget({ sectionId: target.id })}
                      />
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        ))}
      </main>
    </PlaybackProvider>
  )
}
