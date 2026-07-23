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
import { fetchSegmentsForIssue, parseSegment, publishSegment, fetchTranscripts } from '../lib/segment'
import { extractMentionedNpubs } from './SectionExcerpt'
import { uploadBlob } from '../lib/blossom'
import { isLocalTranscriptionEnabled, transcribeAndPublish } from '../lib/transcription'
import { computeSeedOrder } from '../lib/ordering'
import { PlaybackProvider } from '../lib/playback'
import { fetchProfiles, type Profile } from '../lib/profiles'
import { getPool } from '../lib/pool'
import { deleteDraft, listDrafts, saveDraft, type RecordingDraft } from '../lib/drafts'
import type { Filter } from 'nostr-tools'
import { DEFAULT_RELAYS, KINDS, ISSUE_PREFIX } from '../config'

interface Props {
  issue: CompassIssue
  signer: NostrSigner
  myPubkey: string
  isWhitelisted: boolean
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

export default function IssueTimeline({ issue, signer, myPubkey, isWhitelisted }: Props) {
  const [sections, setSections] = useState<Map<string, SectionState>>(new Map())
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
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
    setSections(() => {
      const next = new Map<string, SectionState>()
      for (const t of allTargets) next.set(t.id, { segments: [], order: [], loading: true, error: null })
      return next
    })

    fetchSegmentsForIssue(`${ISSUE_PREFIX}-${issue.issueNumber}`)
      .then((grouped) => {
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
            next.set(t.id, { segments: parsed, order: computeSeedOrder(parsed), loading: false, error: null })
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
        if (allParsed.length) {
          fetchProfiles(allParsed.map((s) => s.event.pubkey)).then((map) => {
            if (!mounted) return
            setProfiles((prev) => new Map([...prev, ...map]))
          })
          // Fetch transcripts for all segments (kind 1111 companions)
          fetchTranscripts(allParsed.map((s) => s.event.id)).then((map) => {
            if (!mounted) return
            setTranscripts((prev) => {
              const next = new Map(prev)
              for (const [id, t] of map) {
                try {
                  const parsed = JSON.parse(t.text) as { text?: string }
                  next.set(id, parsed.text ?? t.text)
                } catch {
                  next.set(id, t.text)
                }
              }
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
  }, [allTargets, issue.issueNumber])

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
          if (knownIdsRef.current.has(event.id)) return
          knownIdsRef.current.add(event.id)
          const seg = parseSegment(event)
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
  // Cache the upload descriptor + recording across a failed publish so a retry
  // reuses the already-uploaded blob; IndexedDB keeps this state across reloads.
  const pendingRef = useRef<{
    target: RecordTarget
    result: InlineRecordingResult
    descriptor: import('../types/nostr').BlobDescriptor | null
    draftId: string
  } | null>(null)
  const [uploadStage, setUploadStage] = useState<string | null>(null)
  const [pendingDraft, setPendingDraft] = useState<RecordingDraft | null>(null)

  const handleRecorded = useCallback(
    async (result: InlineRecordingResult, restoredTarget?: RecordTarget) => {
      // Fallback: plain (non-reply) recorders don't set recordTarget — infer
      // the section from the most recently armed plain recorder.
      const target = restoredTarget ?? recordTarget ?? plainTargetRef.current ?? pendingRef.current?.target
      if (!target) return
      const draftId = pendingRef.current?.draftId ?? crypto.randomUUID()
      const persistDraft = async (descriptor: import('../types/nostr').BlobDescriptor | null) => {
        const draft: RecordingDraft = {
          id: draftId,
          issueNumber: issue.issueNumber,
          target: { sectionId: target.sectionId, respondingTo: target.respondingTo ?? null },
          blob: result.blob,
          duration: result.duration,
          waveform: result.waveform,
          descriptor,
          updatedAt: Date.now(),
        }
        try {
          await saveDraft(draft)
          setPendingDraft(draft)
        } catch (error) {
          // Storage can be unavailable in private browsing; publishing remains
          // available, but the user gets an explicit warning if it later fails.
          console.warn('Unable to persist recording draft:', error)
        }
      }
      await persistDraft(pendingRef.current?.descriptor ?? null)
      setPublishing(true)
      setPublishError(null)
      try {
        // Reuse a prior attempt's descriptor if the upload already succeeded —
        // otherwise the blob gets re-uploaded and the old one is orphaned.
        let descriptor = pendingRef.current?.descriptor ?? null
        if (!descriptor) {
          const up = await uploadBlob(result.blob, signer, undefined, (stage) =>
            setUploadStage(stage),
          )
          descriptor = up.descriptor
          await persistDraft(descriptor)
          if (up.mirrorFailures.length) {
            console.warn('Some mirrors failed:', up.mirrorFailures)
          }
        }
        pendingRef.current = { target, result, descriptor, draftId }

        const event = await publishSegment({
          signer,
          blob: descriptor,
          duration: result.duration,
          waveform: result.waveform,
          sectionId: target.sectionId,
          issueNumber: issue.issueNumber,
          respondingTo: target.respondingTo,
        })
        // Published — delete the crash-safe draft only after relay publishing succeeds.
        pendingRef.current = null
        await deleteDraft(draftId).catch((error) => console.warn('Unable to remove published recording draft:', error))
        setPendingDraft(null)
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
            setJustPublished((prev) => {
              const next = new Set(prev)
              next.delete(newSeg.event.id)
              return next
            })
          }, 3000)
        }
        setRecordTarget(null)
        // Transcription is deliberately opt-in while the browser inference
        // dependency tree has unresolved upstream audit findings.
        if (isLocalTranscriptionEnabled()) {
          void transcribeAndPublish(result.blob, event, signer).then(() => {
            // Transcript will arrive via the live fetch on next load.
          })
        }
    } catch (err) {
        // Keep the pending recording + descriptor so the user can retry without
        // re-recording or re-uploading. Surface a visible banner — never silent.
        console.error('Publish failed:', err)
        const msg = err instanceof Error ? err.message : String(err)
        setPublishError(`Publish failed — recording NOT lost, tap Record again to retry. (${msg.slice(0, 160)})`)
      } finally {
        setPublishing(false)
        setUploadStage(null)
      }
    },
    [recordTarget, signer, issue.issueNumber],
  )

  // Restore the newest local take for this issue. It is never published
  // automatically; the contributor explicitly resumes the upload.
  useEffect(() => {
    let alive = true
    listDrafts(issue.issueNumber).then((drafts) => {
      if (!alive || !drafts[0]) return
      const draft = drafts[0]
      const target: RecordTarget = {
        sectionId: draft.target.sectionId,
        respondingTo: draft.target.respondingTo ?? undefined,
      }
      pendingRef.current = {
        target,
        result: { blob: draft.blob, duration: draft.duration, waveform: draft.waveform },
        descriptor: draft.descriptor,
        draftId: draft.id,
      }
      setPendingDraft(draft)
    }).catch((error) => console.warn('Unable to restore recording draft:', error))
    return () => { alive = false }
  }, [issue.issueNumber])

  const retryPendingDraft = useCallback(() => {
    const pending = pendingRef.current
    if (!pending || publishing) return
    void handleRecorded(pending.result, pending.target)
  }, [handleRecorded, publishing])

  const discardPendingDraft = useCallback(() => {
    const id = pendingRef.current?.draftId
    pendingRef.current = null
    setPendingDraft(null)
    if (id) void deleteDraft(id).catch((error) => console.warn('Unable to discard recording draft:', error))
  }, [])

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
        {publishing && (
          <div className="timeline__publish-status">
            {uploadStage ? `Uploading… ${uploadStage}` : 'Publishing recording…'}
          </div>
        )}
        {publishError && (
          <div className="timeline__publish-error" role="alert">{publishError}</div>
        )}
        {pendingDraft && !publishing && (
          <div className="timeline__publish-status" role="status">
            A recording from {new Date(pendingDraft.updatedAt).toLocaleString()} is saved on this device.
            <button type="button" onClick={retryPendingDraft}>Resume publish</button>
            <button type="button" onClick={discardPendingDraft}>Discard</button>
          </div>
        )}
        {groups.map(({ group, targets }) => (
          <div key={group.id} className="timeline__group">
            <h2 className="timeline__group-title">{group.title}</h2>

            {targets.map((target) => {
              const state = sections.get(target.id)
              const isRecordingHere = recordTarget?.sectionId === target.id && !recordTarget?.respondingTo

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
                              onReply={isWhitelisted ? handleReply : undefined}
                              isWhitelisted={isWhitelisted}
                              isNew={newSegmentIds.has(id)}
                              isOwn={seg.event.pubkey === myPubkey}
                              justPublished={justPublished.has(id)}
                            />
                            {isReplyingHere && !pendingDraft && (
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

                  {isWhitelisted && !pendingDraft && !isRecordingHere && !publishing && (
                    <div className="timeline__recrow">
                      <InlineRecorder
                        onRecorded={handleRecorded}
                        onArm={() => { plainTargetRef.current = { sectionId: target.id } }}
                      />
                    </div>
                  )}
                  {isRecordingHere && !pendingDraft && (
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
