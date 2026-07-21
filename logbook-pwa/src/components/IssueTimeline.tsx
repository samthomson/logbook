/**
 * IssueTimeline — the podcast preparation surface.
 *
 * Layout per section:
 *   ┌ Section title ──────────────────────── [● Record] ┐
 *   │ Excerpt of the Compass text (expandable)          │
 *   │ ▶ note row 1                            0:42   ↩  │
 *   │ ▶ note row 2 (reply)                    1:15   ↩  │
 *   └───────────────────────────────────────────────────┘
 *
 * Playback is a single issue-wide queue: play any note and the rest follow
 * automatically. Recording/replying is one tap — the recorder pops up inline
 * at the tapped spot, mic starts on the next tap.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import NoteRow from './NoteRow'
import Recorder from './Recorder'
import SectionExcerpt from './SectionExcerpt'
import type { RecordingResult } from './Recorder'
import type {
  CompassIssue,
  Segment,
  IssueSection,
  NostrSigner,
  NostrEvent,
} from '../types/nostr'
import { fetchSegmentsForSection, parseSegment, publishSegment } from '../lib/segment'
import { uploadBlob } from '../lib/blossom'
import { computeSeedOrder } from '../lib/ordering'
import { PlaybackProvider } from '../lib/playback'
import { SimplePool } from 'nostr-tools/pool'
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

export default function IssueTimeline({ issue, signer, isWhitelisted }: Props) {
  const [sections, setSections] = useState<Map<string, SectionState>>(new Map())
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [newSegmentIds, setNewSegmentIds] = useState<Set<string>>(new Set())
  const knownIdsRef = useMemo(() => ({ ids: new Set<string>() }), [])
  const mountedAtRef = useMemo(() => ({ t: Math.floor(Date.now() / 1000) }), [])

  const toggleExcerpt = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Load segments for each section
  useEffect(() => {
    let mounted = true
    for (const section of issue.sections) {
      setSections((prev) => {
        const next = new Map(prev)
        next.set(section.id, { segments: [], order: [], loading: true, error: null })
        return next
      })

      fetchSegmentsForSection(section.id, `${ISSUE_PREFIX}-${issue.issueNumber}`)
        .then((events: NostrEvent[]) => {
          if (!mounted) return
          const parsed = events.flatMap((e) => {
            const s = parseSegment(e)
            return s ? [s] : []
          })
          for (const seg of parsed) knownIdsRef.ids.add(seg.event.id)
          const order = computeSeedOrder(parsed)
          setSections((prev) => {
            const next = new Map(prev)
            next.set(section.id, { segments: parsed, order, loading: false, error: null })
            return next
          })
        })
        .catch((err: unknown) => {
          if (!mounted) return
          setSections((prev) => {
            const next = new Map(prev)
            next.set(section.id, {
              segments: [],
              order: [],
              loading: false,
              error: err instanceof Error ? err.message : String(err),
            })
            return next
          })
        })
    }
    return () => {
      mounted = false
    }
  }, [issue, knownIdsRef])

  // Live subscription for late-arriving segments
  useEffect(() => {
    if (!issue.sections.length) return
    const pool = new SimplePool()
    const issueId = `${ISSUE_PREFIX}-${issue.issueNumber}`
    const sectionIds = new Set(issue.sections.map((s) => s.id))
    const sub = pool.subscribeMany(
      DEFAULT_RELAYS,
      { kinds: [KINDS.SEGMENT], '#t': [issueId], since: mountedAtRef.t } as Filter,
      {
        onevent(event: NostrEvent) {
          if (knownIdsRef.ids.has(event.id)) return
          knownIdsRef.ids.add(event.id)
          const seg = parseSegment(event)
          if (!seg || !sectionIds.has(seg.sectionId)) return
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
        },
      },
    )
    return () => sub.close()
  }, [issue, knownIdsRef, mountedAtRef])

  const handleRecord = useCallback(
    (section: IssueSection) => {
      setRecordTarget({ sectionId: section.id, issueNumber: issue.issueNumber })
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

  // Flatten all sections' ordered segments into the issue-wide playback queue
  const queue = useMemo(() => {
    const out: Segment[] = []
    for (const section of issue.sections) {
      const state = sections.get(section.id)
      if (!state) continue
      for (const id of state.order) {
        const seg = state.segments.find((s) => s.event.id === id)
        if (seg) out.push(seg)
      }
    }
    return out
  }, [issue.sections, sections])

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
        {issue.sections.map((section) => {
          const state = sections.get(section.id)
          const isRecordingHere =
            recordTarget?.sectionId === section.id && !recordTarget?.respondingTo
          const expanded = expandedSections.has(section.id)

          return (
            <section key={section.id} className="timeline__section">
              <div className="timeline__section-header">
                <h2 className="timeline__section-title">{section.title}</h2>
                {isWhitelisted && !isRecordingHere && (
                  <button
                    className="btn btn--record-inline"
                    onClick={() => handleRecord(section)}
                    aria-label={`Record a note for ${section.title}`}
                  >
                    ● Record
                  </button>
                )}
              </div>

              <SectionExcerpt
                section={section}
                expanded={expanded}
                onToggle={() => toggleExcerpt(section.id)}
              />

              {isRecordingHere && recorderBlock}

              {state?.loading && <p className="timeline__loading">Loading notes…</p>}
              {state?.error && <p className="timeline__error">Error: {state.error}</p>}

              <div className="timeline__notes">
                {state?.order.map((id) => {
                  const seg = state.segments.find((s) => s.event.id === id)
                  if (!seg) return null
                  const isReplyingHere =
                    recordTarget?.sectionId === section.id &&
                    recordTarget?.respondingTo === seg.event.id
                  return (
                    <div key={id} className="timeline__note">
                      <NoteRow
                        segment={seg}
                        onReply={isWhitelisted ? handleReply : undefined}
                        isWhitelisted={isWhitelisted}
                        isNew={newSegmentIds.has(id)}
                      />
                      {isReplyingHere && recorderBlock}
                    </div>
                  )
                })}
              </div>

              {state && !state.loading && state.order.length === 0 && !isRecordingHere && (
                <p className="timeline__empty">
                  {isWhitelisted ? 'No notes yet — be the first to record.' : 'No notes yet.'}
                </p>
              )}
            </section>
          )
        })}
      </main>
    </PlaybackProvider>
  )
}
