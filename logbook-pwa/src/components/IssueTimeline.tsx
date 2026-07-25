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
import { fetchSegmentsForIssue, parseSegment, publishSegment, fetchTranscripts, selectTrustedSegmentEvents } from '../lib/segment'
import { fetchManifest } from '../lib/manifest'
import { orderTimelineSegments } from '../lib/timeline-order'
import { saveCachedIssue } from '../lib/issue-cache'
import { extractMentionedNpubs } from './SectionExcerpt'
import { uploadBlob } from '../lib/blossom'
import { collectCommunityNotes } from '../lib/community-notes'
import { computeSeedOrder } from '../lib/ordering'
import { PlaybackProvider } from '../lib/playback'
import { fetchProfiles, type Profile } from '../lib/profiles'
import { getPool } from '../lib/pool'
import { deleteDraft, draftBelongsTo, listDrafts, saveDraft, selectDraftForPrincipal, type RecordingDraft } from '../lib/drafts'
import type { Filter } from 'nostr-tools'
import { BLOSSOM_SERVERS, DEFAULT_RELAYS, KINDS, ISSUE_PREFIX } from '../config'
import { areRequestScopesCurrent, createLatestRequestGuard, type LatestRequestGuard } from '../lib/latest-request'

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
  const [publishRequests] = useState(createLatestRequestGuard)
  const [sections, setSections] = useState<Map<string, SectionState>>(new Map())
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [uploadStage, setUploadStage] = useState<string | null>(null)
  const [pendingDraft, setPendingDraft] = useState<RecordingDraft | null>(null)
  const [justPublished, setJustPublished] = useState<Set<string>>(new Set())
  const [newSegmentIds, setNewSegmentIds] = useState<Set<string>>(new Set())
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const [transcripts, setTranscripts] = useState<Map<string, string>>(new Map())
  const knownIdsRef = useRef<Set<string>>(new Set())
  const mountedAtRef = useRef<number>(Math.floor(Date.now() / 1000))

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
    setSections(() => {
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
        const allParsed: Segment[] = []
        const orphaned: Segment[] = []
        setSections(() => {
          const next = new Map<string, SectionState>()
          const knownIds = new Set(allTargets.map((t) => t.id))
          for (const t of allTargets) {
            const events = grouped.get(t.id) ?? []
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
          for (const [secId, events] of grouped) {
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
        void saveCachedIssue(issue, [...grouped.entries()]).catch((error) => console.warn('Unable to cache public timeline:', error))
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
          for (const t of allTargets) next.set(t.id, { segments: [], order: [], loading: false, error: message })
          return next
        })
      })

    return () => { mounted = false }
  }, [allTargets, cachedSegments, issue])

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
          const trustedEvent = selectTrustedSegmentEvents([event], issueId, BLOSSOM_SERVERS)[0]
          if (!trustedEvent || knownIdsRef.current.has(trustedEvent.id)) return
          knownIdsRef.current.add(trustedEvent.id)
          const seg = parseSegment(trustedEvent)
          if (!seg) return
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
  }, [allTargets, issue.issueNumber])

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

  // Tracks which section's plain (non-reply) recorder was last armed, so
  // handleRecorded can resolve the target even when recordTarget is null.
  const plainTargetRef = useRef<RecordTarget | null>(null)
  useEffect(() => {
    publishRequests.invalidate()
    setPublishing(false)
    setUploadStage(null)
    setPublishError(null)
    if (!recordingEnabled) {
      setRecordTarget(null)
      plainTargetRef.current = null
    }
    return () => publishRequests.invalidate()
  }, [issue.issueNumber, myPubkey, publishRequests, recordingEnabled, signer])
  // Cache the upload descriptor + recording across a failed publish so a retry
  // reuses the already-uploaded blob; IndexedDB keeps this state across reloads.
  const pendingRef = useRef<{
    ownerPubkey: string
    target: RecordTarget
    result: InlineRecordingResult
    descriptor: import('../types/nostr').BlobDescriptor | null
    draftId: string
  } | null>(null)

  const handleRecorded = useCallback(
    async (result: InlineRecordingResult, restoredTarget?: RecordTarget) => {
      if (!recordingEnabled || !signer || !myPubkey) return
      const ownerPubkey = myPubkey
      // Fallback: plain (non-reply) recorders don't set recordTarget — infer
      // the section from the most recently armed plain recorder.
      const resumablePending = pendingRef.current?.ownerPubkey === ownerPubkey
        ? pendingRef.current
        : null
      const target = restoredTarget ?? recordTarget ?? plainTargetRef.current ?? resumablePending?.target
      if (!target) return
      const publishRequest = publishRequests.begin()
      const isPublishingActive = () => {
        const current = publishCapabilityRef.current
        return areRequestScopesCurrent(
          capabilityRequests,
          capabilityRequest,
          publishRequests,
          publishRequest,
        )
          && current.recordingEnabled
          && current.signer === signer
          && current.myPubkey === myPubkey
          && current.issueNumber === issue.issueNumber
      }
      const assertPublishingActive = () => {
        if (!isPublishingActive()) {
          throw new Error('Publishing authorization was revoked.')
        }
      }
      if (!isPublishingActive()) return
      const draftId = resumablePending?.draftId ?? crypto.randomUUID()
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
        // Render the in-place upload bubble before IndexedDB finishes so stop
        // never leaves a visual gap on slower devices.
        pendingRef.current = { ownerPubkey, target, result, descriptor, draftId }
        setPendingDraft(draft)
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
        setPublishing(true)
        setPublishError(null)
        setUploadStage('Preparing upload')
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
            (stage) => setUploadStage(stage),
            assertPublishingActive,
          )
          descriptor = up.descriptor
          await persistDraft(descriptor)
          if (up.mirrorFailures.length) {
            console.warn('Some mirrors failed:', up.mirrorFailures)
          }
        }
        assertPublishingActive()
        pendingRef.current = { ownerPubkey, target, result, descriptor, draftId }
        setUploadStage('Publishing to relays')

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
        if (pendingRef.current?.draftId === draftId) pendingRef.current = null
        setPendingDraft((current) => current?.id === draftId ? null : current)
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
            if (!isPublishingActive()) return
            setJustPublished((prev) => {
              const next = new Set(prev)
              next.delete(newSeg.event.id)
              return next
            })
          }, 3000)
        }
        setRecordTarget(null)
      } catch (err) {
        if (isPublishingActive()) {
          // Keep the pending recording + descriptor so a current contributor can
          // retry without re-recording or re-uploading. Stale sessions stay silent.
          console.error('Publish failed:', err)
          const msg = err instanceof Error ? err.message : String(err)
          setPublishError(`Publish failed — recording NOT lost, tap Record again to retry. (${msg.slice(0, 160)})`)
        }
      } finally {
        if (isPublishingActive()) {
          setPublishing(false)
          setUploadStage(null)
        }
      }
    },
    [capabilityRequest, capabilityRequests, issue.issueNumber, myPubkey, publishRequests, recordTarget, recordingEnabled, signer],
  )

  // Restore the newest local take for this issue. It is never published
  // automatically; the contributor explicitly resumes the upload.
  useEffect(() => {
    pendingRef.current = null
    setPendingDraft(null)
    let alive = true
    listDrafts(issue.issueNumber).then((drafts) => {
      if (!alive) return
      const draft = selectDraftForPrincipal(drafts, myPubkey)
      if (!draft) return
      const target: RecordTarget = {
        sectionId: draft.target.sectionId,
        respondingTo: draft.target.respondingTo ?? undefined,
      }
      if (draftBelongsTo(draft, myPubkey)) {
        pendingRef.current = {
          ownerPubkey: draft.ownerPubkey,
          target,
          result: { blob: draft.blob, duration: draft.duration, waveform: draft.waveform },
          descriptor: draft.descriptor,
          draftId: draft.id,
        }
      }
      setPendingDraft(draft)
    }).catch((error) => console.warn('Unable to restore recording draft:', error))
    return () => { alive = false }
  }, [issue.issueNumber, myPubkey])

  const retryPendingDraft = useCallback(() => {
    const pending = pendingRef.current
    if (!pending || pending.ownerPubkey !== myPubkey || publishing) return
    void handleRecorded(pending.result, pending.target)
  }, [handleRecorded, myPubkey, publishing])

  const discardPendingDraft = useCallback(() => {
    if (
      capabilityRequest === null
      || !capabilityRequests.isCurrent(capabilityRequest)
      || !pendingDraft
      || !draftBelongsTo(pendingDraft, myPubkey)
    ) return
    const id = pendingRef.current?.draftId
    if (!id) return
    pendingRef.current = null
    setPendingDraft(null)
    void deleteDraft(id).catch((error) => console.warn('Unable to discard recording draft:', error))
  }, [capabilityRequest, capabilityRequests, myPubkey, pendingDraft])

  const communityNotes = useMemo(
    () => collectCommunityNotes([...sections.values()].map((state) => state.segments), myPubkey ?? ''),
    [myPubkey, sections],
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
          {leadProse && <SectionExcerpt section={{ id: '__lead', title: '', items: [{ title: '', body: leadProse }] }} />}
        </header>
        {publishError && (
          <div className="timeline__publish-error" role="alert">{publishError}</div>
        )}
        {communityNotes.length > 0 && (
          <section className="timeline__group timeline__community" aria-label="Voice notes from other contributors">
            <h2 className="timeline__group-title">Other contributors · {communityNotes.length} notes</h2>
            <div className="timeline__community-links">
              {communityNotes.map((seg) => (
                <a key={seg.event.id} href={`#voice-note-${seg.event.id}`}>
                  {profiles.get(seg.event.pubkey)?.name ?? seg.event.pubkey.slice(0, 8)}
                </a>
              ))}
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

              return (
                <section key={target.id} className="timeline__section">
                  {target.item && (
                    <SectionExcerpt section={{ id: target.id, title: target.title, items: [target.item] }} />
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
                              onReply={recordingEnabled ? handleReply : undefined}
                              isWhitelisted={recordingEnabled}
                              isNew={newSegmentIds.has(id)}
                              isOwn={seg.event.pubkey === myPubkey}
                              justPublished={justPublished.has(id)}
                            />
                            {recordingEnabled && isReplyingHere && !pendingDraft && (
                              <InlineRecorder
                                onRecorded={handleRecorded}
                                onCancel={() => setRecordTarget(null)}
                                autoStart
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {pendingDraft?.target.sectionId === target.id && (
                    <UploadBubble
                      draft={pendingDraft}
                      stage={uploadStage}
                      publishing={publishing}
                      canResume={recordingEnabled && draftBelongsTo(pendingDraft, myPubkey)}
                      canDiscard={recordingEnabled && draftBelongsTo(pendingDraft, myPubkey)}
                      onResume={retryPendingDraft}
                      onDiscard={discardPendingDraft}
                    />
                  )}

                  {recordingEnabled && !pendingDraft && !isRecordingHere && !publishing && (
                    <div className="timeline__recrow">
                      <InlineRecorder
                        onRecorded={handleRecorded}
                        onArm={() => { plainTargetRef.current = { sectionId: target.id } }}
                      />
                    </div>
                  )}
                  {recordingEnabled && isPlainRecordingHere && !pendingDraft && (
                    <div className="timeline__recrow">
                      <InlineRecorder
                        onRecorded={handleRecorded}
                        onCancel={() => setRecordTarget(null)}
                        autoStart
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
