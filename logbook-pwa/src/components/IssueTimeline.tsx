/**
 * IssueTimeline — renders sections in newsletter order with note lists.
 *
 * Fetches segments for each section, computes seed order, shows NoteCards.
 * When a whitelisted user taps "Record" or "Reply", opens the Recorder.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import NoteCard from './NoteCard'
import Recorder from './Recorder'
import type { RecordingResult } from './Recorder'
import type { CompassIssue, Segment, IssueSection, NostrSigner, NostrEvent } from '../types/nostr'
import { fetchSegmentsForSection } from '../lib/segment'
import { parseSegment, publishSegment } from '../lib/segment'
import { uploadBlob } from '../lib/blossom'
import { computeSeedOrder } from '../lib/ordering'
import { SimplePool } from 'nostr-tools/pool'
import type { Filter } from 'nostr-tools'
import { DEFAULT_RELAYS, KINDS, ISSUE_PREFIX } from '../config'

interface Props {
  issue: CompassIssue
  signer: NostrSigner
  isWhitelisted: boolean
  isAdmin?: boolean
  onOpenAdmin?: () => void
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
  const [highlightId, setHighlightId] = useState<string | undefined>()
  const [newSegmentIds, setNewSegmentIds] = useState<Set<string>>(new Set())
  const noteRefs = useRef<Map<string, HTMLElement>>(new Map())
  // Track which segment IDs existed at load time so we can mark later arrivals "new"
  const knownIdsRef = useRef<Set<string>>(new Set())
  // Timestamp when this component mounted — used as the since filter for the subscription
  const mountedAtRef = useRef<number>(Math.floor(Date.now() / 1000))

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
          // Register all initially-loaded IDs as known so live arrivals can be diffed
          for (const seg of parsed) knownIdsRef.current.add(seg.event.id)
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

    return () => { mounted = false }
  }, [issue])

  // Subscribe for late-arriving segments after initial load
  useEffect(() => {
    if (!issue.sections.length) return
    const pool = new SimplePool()
    const issueId = `${ISSUE_PREFIX}-${issue.issueNumber}`
    const sectionIds = new Set(issue.sections.map((s) => s.id))
    const sub = pool.subscribeMany(
      DEFAULT_RELAYS,
      { kinds: [KINDS.SEGMENT], '#t': [issueId], since: mountedAtRef.current } as Filter,
      {
        onevent(event: NostrEvent) {
          if (knownIdsRef.current.has(event.id)) return
          knownIdsRef.current.add(event.id)
          const seg = parseSegment(event)
          if (!seg || !sectionIds.has(seg.sectionId)) return
          // Append to section state and mark as new
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
    return () => { sub.close() }
  }, [issue])

  const handleRecord = useCallback((section: IssueSection) => {
    setRecordTarget({ sectionId: section.id, issueNumber: issue.issueNumber })
    setUploadStatus('idle')
    setUploadError(null)
  }, [issue.issueNumber])

  const handleReply = useCallback((segment: Segment) => {
    setRecordTarget({
      sectionId: segment.sectionId,
      issueNumber: issue.issueNumber,
      respondingTo: segment.event.id,
    })
    setUploadStatus('idle')
    setUploadError(null)
  }, [issue.issueNumber])

  const handleScrollToParent = useCallback((eventId: string) => {
    setHighlightId(eventId)
    const el = noteRefs.current.get(eventId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => setHighlightId(undefined), 2000)
  }, [])

  const handleRecorded = useCallback(async (result: RecordingResult) => {
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
      // Optimistically add the new segment to the section
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
      }, 1500)
    } catch (err) {
      setUploadStatus('error')
      setUploadError(err instanceof Error ? err.message : String(err))
    }
  }, [recordTarget, signer])

  return (
    <main className="timeline">
      <h1 className="timeline__title">{issue.title}</h1>

      {issue.sections.map((section) => {
        const state = sections.get(section.id)
        const isRecordingHere = recordTarget?.sectionId === section.id && !recordTarget?.respondingTo

        return (
          <section key={section.id} className="timeline__section">
            <div className="timeline__section-header">
              <h2 className="timeline__section-title">{section.title}</h2>
              {isWhitelisted && !isRecordingHere && uploadStatus !== 'uploading' && uploadStatus !== 'publishing' && (
                <button
                  className="btn btn--ghost btn--small"
                  onClick={() => handleRecord(section)}
                  aria-label={`Record a note for ${section.title}`}
                >
                  &#9679; Record
                </button>
              )}
            </div>

            {isRecordingHere && (
              <div className="timeline__recorder">
                {uploadStatus === 'idle' && (
                  <Recorder
                    onRecorded={handleRecorded}
                    onCancel={() => setRecordTarget(null)}
                  />
                )}
                {uploadStatus === 'uploading' && <p className="upload-status">Uploading to Blossom…</p>}
                {uploadStatus === 'publishing' && <p className="upload-status">Publishing to Nostr…</p>}
                {uploadStatus === 'done' && <p className="upload-status upload-status--done">Published!</p>}
                {uploadStatus === 'error' && (
                  <div className="upload-status upload-status--error">
                    <p>Upload failed: {uploadError}</p>
                    <button className="btn btn--ghost btn--small" onClick={() => setUploadStatus('idle')}>
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}

            {state?.loading && <p className="timeline__loading">Loading notes…</p>}
            {state?.error && <p className="timeline__error">Error: {state.error}</p>}

            {state && !state.loading && state.order.length === 0 && (
              <p className="timeline__empty">No notes yet for this section.</p>
            )}

            <div className="timeline__notes">
              {state?.order.map((id) => {
                const seg = state.segments.find((s) => s.event.id === id)
                if (!seg) return null
                const isReplyingHere =
                  recordTarget?.sectionId === section.id &&
                  recordTarget?.respondingTo === seg.event.id

                return (
                  <div
                    key={id}
                    ref={(el) => {
                      if (el) noteRefs.current.set(id, el)
                      else noteRefs.current.delete(id)
                    }}
                  >
                    <NoteCard
                      segment={seg}
                      onReply={isWhitelisted ? handleReply : undefined}
                      onScrollToParent={handleScrollToParent}
                      isWhitelisted={isWhitelisted}
                      highlightId={highlightId}
                      isNew={newSegmentIds.has(id)}
                    />

                    {isReplyingHere && (
                      <div className="timeline__recorder timeline__recorder--reply">
                        {uploadStatus === 'idle' && (
                          <Recorder
                            onRecorded={handleRecorded}
                            onCancel={() => setRecordTarget(null)}
                          />
                        )}
                        {uploadStatus === 'uploading' && <p className="upload-status">Uploading…</p>}
                        {uploadStatus === 'publishing' && <p className="upload-status">Publishing…</p>}
                        {uploadStatus === 'done' && <p className="upload-status upload-status--done">Published!</p>}
                        {uploadStatus === 'error' && (
                          <div className="upload-status upload-status--error">
                            <p>{uploadError}</p>
                            <button className="btn btn--ghost btn--small" onClick={() => setUploadStatus('idle')}>
                              Retry
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </main>
  )
}
