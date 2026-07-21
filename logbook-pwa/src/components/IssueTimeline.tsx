/**
 * IssueTimeline — the podcast preparation surface.
 *
 * Layout per topic group (H2):
 *   Lead stories
 *   ─────────────────────────────────────────
 *   [project item] excerpt text (expandable)
 *     💬 voice bubbles (Telegram-style, per project)
 *     [● Record]  ← one button, under the notes
 *   ─────────────────────────────────────────
 *
 * Playback is one issue-wide queue with auto-advance. Recording/replying is
 * one tap — the recorder pops inline at the tapped spot.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import VoiceBubble from './VoiceBubble'
import Recorder from './Recorder'
import SectionExcerpt from './SectionExcerpt'
import type { RecordingResult } from './Recorder'
import type {
  CompassIssue,
  Segment,
  IssueSection,
  IssueSectionItem,
  NostrSigner,
  NostrEvent,
} from '../types/nostr'
import { fetchSegmentsForIssue, parseSegment, publishSegment } from '../lib/segment'
import { extractMentionedNpubs } from './SectionExcerpt'
import { uploadBlob } from '../lib/blossom'
import { computeSeedOrder } from '../lib/ordering'
import { PlaybackProvider } from '../lib/playback'
import { fetchProfiles, type Profile } from '../lib/profiles'
import { getPool } from '../lib/pool'
import type { Filter } from 'nostr-tools'
import { DEFAULT_RELAYS, KINDS, ISSUE_PREFIX } from '../config'

interface Props {
  issue: CompassIssue
  signer: NostrSigner
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
  issueNumber: number
  respondingTo?: string
}

type UploadStatus = 'idle' | 'uploading' | 'publishing' | 'done' | 'error'

/** A recording target = one H3 project item, or the section itself if no H3s. */
interface RecordingSection {
  id: string
  title: string
  item?: IssueSectionItem
}

/** Flatten the issue into recording sections: one per H3 item (plus lead). */
function recordingSections(issue: CompassIssue): { group: IssueSection; targets: RecordingSection[] }[] {
  return issue.sections.map((group) => {
    const named = group.items.filter((it) => it.title && it.id)
    const targets: RecordingSection[] = named.map((it) => ({
      id: it.id!,
      title: it.title,
      item: it,
    }))
    // H2 lead prose (if any) gets its own target at the group level
    const lead = group.items.find((it) => !it.title)
    if (lead?.body.trim() || targets.length === 0) {
      targets.unshift({ id: group.id, title: group.title, item: lead })
    }
    return { group, targets }
  })
}

export default function IssueTimeline({ issue, signer, isWhitelisted }: Props) {
  const [sections, setSections] = useState<Map<string, SectionState>>(new Map())
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [newSegmentIds, setNewSegmentIds] = useState<Set<string>>(new Set())
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const knownIdsRef = useRef<Set<string>>(new Set())
  const mountedAtRef = useRef<number>(Math.floor(Date.now() / 1000))

  const groups = useMemo(() => recordingSections(issue), [issue])
  const allTargets = useMemo(() => groups.flatMap((g) => g.targets), [groups])

  // Prefetch kind-0 profiles for every npub mentioned anywhere in the issue
  // (ONE batched relay query) so excerpts render names without N waterfalls.
  useEffect(() => {
    const fullText = issue.sections
      .flatMap((s) => s.items.map((it) => it.body))
      .join('\n\n')
    const npubs = extractMentionedNpubs(fullText)
    if (!npubs.length) return
    let alive = true
    fetchProfiles(npubs).then((map) => {
      if (alive) setProfiles((prev) => new Map([...prev, ...map]))
    })
    return () => {
      alive = false
    }
  }, [issue])

  const toggleExcerpt = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Load ALL segments for the issue in ONE relay query, then group per section
  useEffect(() => {
    let mounted = true

    // Mark all targets loading up front (single setState)
    setSections(() => {
      const next = new Map<string, SectionState>()
      for (const t of allTargets) {
        next.set(t.id, { segments: [], order: [], loading: true, error: null })
      }
      return next
    })

    fetchSegmentsForIssue(`${ISSUE_PREFIX}-${issue.issueNumber}`)
      .then((grouped) => {
        if (!mounted) return

        const allParsed: Segment[] = []
        setSections(() => {
          const next = new Map<string, SectionState>()
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
            next.set(t.id, {
              segments: parsed,
              order: computeSeedOrder(parsed),
              loading: false,
              error: null,
            })
          }
          return next
        })

        // ONE batched profile fetch for every author in the issue
        if (allParsed.length) {
          fetchProfiles(allParsed.map((s) => s.event.pubkey)).then((map) => {
            if (!mounted) return
            setProfiles((prev) => new Map([...prev, ...map]))
          })
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return
        const message = err instanceof Error ? err.message : String(err)
        setSections((prev) => {
          const next = new Map(prev)
          for (const t of allTargets) {
            next.set(t.id, { segments: [], order: [], loading: false, error: message })
          }
          return next
        })
      })

    return () => {
      mounted = false
    }
  }, [allTargets, issue.issueNumber])

  // Live subscription for late-arriving segments (shares the app-wide pool)
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
          if (!seg || !targetIds.has(seg.sectionId)) return
          setSections((prev) => {
            const next = new Map(prev)
            const cur = next.get(seg.sectionId)
            if (!cur) return prev
            const newSegments = [...cur.segments, seg]
            const newOrder = computeSeedOrder(newSegments)
            next.set(seg.sectionId, { ...cur, segments: newSegments, order: newOrder })
            return next
          })
          setNewSegmentIds((prev) => new Set([...prev, event.id]))
          fetchProfiles([event.pubkey]).then((map) => {
            setProfiles((prev) => new Map([...prev, ...map]))
          })
        },
      },
    )
    return () => {
      sub.close()
    }
  }, [allTargets, issue.issueNumber])

  const handleRecord = useCallback(
    (sectionId: string) => {
      setRecordTarget({ sectionId, issueNumber: issue.issueNumber })
      setUploadStatus('idle')
      setUploadError(null)
    },
    [issue.issueNumber],
  )

  const handleReply = useCallback(
    (segment: Segment) => {
      setRecordTarget({
        sectionId: segment.sectionId,
        issueNumber: issue.issueNumber,
        respondingTo: segment.event.id,
      })
      setUploadStatus('idle')
      setUploadError(null)
    },
    [issue.issueNumber],
  )

  const handleRecorded = useCallback(
    async (result: RecordingResult) => {
      if (!recordTarget) return
      setUploadStatus('uploading')
      setUploadError(null)
      try {
        const descriptor = await uploadBlob(result.blob, signer)
        setUploadStatus('publishing')
        const event = await publishSegment({
          signer,
          blob: descriptor,
          duration: result.duration,
          waveform: result.waveform,
          sectionId: recordTarget.sectionId,
          issueNumber: recordTarget.issueNumber,
          respondingTo: recordTarget.respondingTo,
        })
        const newSeg = parseSegment(event)
        if (newSeg) {
          setSections((prev) => {
            const next = new Map(prev)
            const cur = next.get(recordTarget.sectionId)
            if (cur) {
              const newSegments = [...cur.segments, newSeg]
              const newOrder = computeSeedOrder(newSegments)
              next.set(recordTarget.sectionId, { ...cur, segments: newSegments, order: newOrder })
            }
            return next
          })
        }
        setUploadStatus('done')
        setTimeout(() => {
          setRecordTarget(null)
          setUploadStatus('idle')
        }, 1200)
      } catch (err) {
        setUploadStatus('error')
        setUploadError(err instanceof Error ? err.message : String(err))
      }
    },
    [recordTarget, signer],
  )

  // Issue-wide playback queue in display order
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

  const recorderBlock = (
    <div className="timeline__recorder">
      {uploadStatus === 'idle' && (
        <Recorder onRecorded={handleRecorded} onCancel={() => setRecordTarget(null)} />
      )}
      {uploadStatus === 'uploading' && <p className="upload-status">Uploading…</p>}
      {uploadStatus === 'publishing' && <p className="upload-status">Publishing…</p>}
      {uploadStatus === 'done' && <p className="upload-status upload-status--done">Published ✓</p>}
      {uploadStatus === 'error' && (
        <div className="upload-status upload-status--error">
          <p>{uploadError}</p>
          <button className="btn btn--ghost btn--small" onClick={() => setUploadStatus('idle')}>
            Retry
          </button>
        </div>
      )}
    </div>
  )

  return (
    <PlaybackProvider segments={queue}>
      <main className="timeline">
        {groups.map(({ group, targets }) => (
          <div key={group.id} className="timeline__group">
            <h2 className="timeline__group-title">{group.title}</h2>

            {targets.map((target) => {
              const state = sections.get(target.id)
              const isRecordingHere =
                recordTarget?.sectionId === target.id && !recordTarget?.respondingTo
              const expanded = expandedSections.has(target.id)

              return (
                <section key={target.id} className="timeline__section">
                  {target.item && (
                    <SectionExcerpt
                      section={{ id: target.id, title: target.title, items: [target.item] }}
                      expanded={expanded}
                      onToggle={() => toggleExcerpt(target.id)}
                    />
                  )}
                  {!target.item && (
                    <h3 className="timeline__section-title">{target.title}</h3>
                  )}

                  <div className="timeline__notes">
                    {state?.loading && <p className="timeline__loading">…</p>}
                    {state?.order.map((id) => {
                      const seg = state.segments.find((s) => s.event.id === id)
                      if (!seg) return null
                      const isReplyingHere =
                        recordTarget?.sectionId === target.id &&
                        recordTarget?.respondingTo === seg.event.id
                      return (
                        <div key={id} className="timeline__note">
                          <VoiceBubble
                            segment={seg}
                            profile={profiles.get(seg.event.pubkey)}
                            onReply={isWhitelisted ? handleReply : undefined}
                            isWhitelisted={isWhitelisted}
                            isNew={newSegmentIds.has(id)}
                            isOwn={seg.event.pubkey === (signer as { _pubkey?: string })._pubkey}
                          />
                          {isReplyingHere && recorderBlock}
                        </div>
                      )
                    })}
                  </div>

                  {isRecordingHere && recorderBlock}

                  {isWhitelisted && !isRecordingHere && (
                    <button
                      className="btn btn--record-inline timeline__record-btn"
                      onClick={() => handleRecord(target.id)}
                      aria-label={`Record a note for ${target.title}`}
                    >
                      ● Record
                    </button>
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
