/**
 * IssueTimeline — dense podcast preparation surface.
 *
 * Per project item: excerpt (expanded, edge-to-edge) → bubbles → one inline
 * record row. Tapping the mic icon starts recording in place; tapping stop
 * publishes and the bubble appears right where the row was. No boxes, no
 * modal flows. A contributor can record an audio reply under another note.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import VoiceBubble from './VoiceBubble'
import UploadBubble from './UploadBubble'
import InlineRecorder, { type InlineRecordingResult } from './InlineRecorder'
import SectionExcerpt from './SectionExcerpt'
import EventInspector from './EventInspector'
import type {
  CompassIssue,
  Segment,
  IssueSection,
  IssueSectionItem,
  NostrSigner,
  NostrEvent,
} from '../types/nostr'
import { nip19 } from 'nostr-tools'
import { issueAddress } from '../lib/compass'
import { fetchSegmentsForIssue, parseSegment, publishSegment, fetchTranscripts, selectTrustedSegmentEvents } from '../lib/segment'
import { orderTimelineSegments } from '../lib/timeline-order'
import { useEpisodeCut, type ProducerContext } from '../lib/use-episode-cut'
import { pinWindowScroll } from '../lib/pin-scroll'
import { releaseChecklist, type InspectTarget } from '../lib/release-checklist'
import { fetchAnnouncementEvent, fetchPodstrEpisode } from '../lib/release-events'
import ReleaseChecklist from './ReleaseChecklist'
import WhitelistPanel from './WhitelistPanel'
import './Produce.css'
import { saveCachedIssue } from '../lib/issue-cache'
import { extractMentionedNpubs } from '../lib/mentions'
import { uploadBlob } from '../lib/blossom'
import { collectEpisodeNotes } from '../lib/community-notes'
import { computeSeedOrder, nestDisplayOrder } from '../lib/ordering'
import { PlaybackProvider } from '../lib/playback'
import { authorLabel, fetchProfiles, type Profile } from '../lib/profiles'
import { getPool } from '../lib/pool'
import { deleteDraft, draftBelongsTo, listDrafts, saveDraft, selectDraftsForPrincipal, type RecordingDraft } from '../lib/drafts'
import type { Filter } from 'nostr-tools'
import { BLOSSOM_SERVERS, COMPASS_PUBKEY, RELAYS, KINDS, ISSUE_PREFIX } from '../config'
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
  /** Present only for a producer: the same page gains the cut controls. */
  producer?: ProducerContext | null
}

interface SectionState {
  segments: Segment[]
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
  producer = null,
}: Props) {
  const recordingEnabled = canRecord && signer !== null
  const publishCapabilityRef = useRef({ issueNumber: issue.issueNumber, myPubkey, recordingEnabled, signer })
  publishCapabilityRef.current = { issueNumber: issue.issueNumber, myPubkey, recordingEnabled, signer }
  const [sections, setSections] = useState<Map<string, SectionState>>(new Map())
  const [recordTarget, setRecordTarget] = useState<RecordTarget | null>(null)
  const [draftErrors, setDraftErrors] = useState<Map<string, string>>(new Map())
  const [pendingDrafts, setPendingDrafts] = useState<RecordingDraft[]>([])
  const [publishingDraftIds, setPublishingDraftIds] = useState<Set<string>>(new Set())
  const [uploadStages, setUploadStages] = useState<Map<string, string>>(new Map())
  const [justPublished, setJustPublished] = useState<Set<string>>(new Set())
  const [newSegmentIds, setNewSegmentIds] = useState<Set<string>>(new Set())
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const [transcripts, setTranscripts] = useState<Map<string, string>>(new Map())
  const [inspect, setInspect] = useState<{
    event: NostrEvent
    kindLabel: string
    authorLabel: string
    address?: string
  } | null>(null)
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
    // Persist the parsed newsletter immediately. If the OS kills the PWA while
    // relay segments are still loading, the next launch can still render the
    // selected episode instead of returning to a blank spinner.
    void saveCachedIssue(issue, cachedSegments).catch((error) => console.warn('Unable to cache public timeline:', error))
    setSections(() => {
      const next = new Map<string, SectionState>()
      for (const t of allTargets) {
        const cached = (cachedGrouped.get(t.id) ?? []).flatMap((event) => {
          const segment = parseSegment(event)
          return segment ? [segment] : []
        })
        next.set(t.id, { segments: cached, loading: cached.length === 0, error: null })
      }
      return next
    })

    fetchSegmentsForIssue(`${ISSUE_PREFIX}-${issue.issueNumber}`)
      .then((grouped) => {
        if (!mounted) return
        // Build the section map before committing state. A setState updater runs
        // during render, so collecting segments inside one would leave the
        // profile and transcript fetches below reading an empty list.
        const allParsed: Segment[] = []
        const orphaned: Segment[] = []
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
          next.set(t.id, { segments: parsed, loading: false, error: null })
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
            next.set(allTargets[0].id, { ...first, segments: [...first.segments, ...orphaned] })
            allParsed.push(...orphaned)
          }
        }
        setSections(next)
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
          for (const t of allTargets) {
            const current = next.get(t.id)
            next.set(t.id, current
              ? { ...current, loading: false, error: message }
              : { segments: [], loading: false, error: message })
          }
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
      RELAYS,
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
            next.set(destId, { ...cur, segments: [...cur.segments, seg] })
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

  const handleAudioReply = useCallback((segment: Segment) => {
    let home = segment.sectionId
    if (!sections.has(home)) {
      for (const [id, state] of sections) {
        if (state.segments.some((item) => item.event.id === segment.event.id)) {
          home = id
          break
        }
      }
    }
    setRecordTarget({ sectionId: home, respondingTo: segment.event.id })
  }, [sections])

  const pendingRef = useRef<Map<string, PendingTake>>(new Map())
  const activePublishAttemptsRef = useRef<Map<string, symbol>>(new Map())

  const setDraftError = useCallback((draftId: string, message: string | null) => {
    setDraftErrors((current) => {
      const next = new Map(current)
      if (message) next.set(draftId, message)
      else next.delete(draftId)
      return next
    })
  }, [])

  const canResumeDraft = useCallback((draft: RecordingDraft) => (
    recordingEnabled
    && draftBelongsTo(draft, myPubkey)
    && capabilityRequest !== null
    && capabilityRequests.isCurrent(capabilityRequest)
  ), [capabilityRequest, capabilityRequests, myPubkey, recordingEnabled])

  useEffect(() => {
    activePublishAttemptsRef.current.clear()
    setPublishingDraftIds(new Set())
    setUploadStages(new Map())
    setRecordTarget(null)
    return () => { activePublishAttemptsRef.current.clear() }
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
        setDraftError(
          draftId,
          'Recording saved on this device. Resume once contributor access finishes refreshing.',
        )
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
        if (hasVerifiedCapability) {
          setDraftError(
            draftId,
            'Upload could not start — contributor access is still refreshing. Try again in a moment.',
          )
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
        setDraftError(draftId, null)
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
        setDraftError(draftId, null)
        await deleteDraft(draftId).catch((error) => console.warn('Unable to remove published recording draft:', error))
        if (!isPublishingActive()) return
        const newSeg = parseSegment(event)
        if (newSeg) {
          knownIdsRef.current.add(newSeg.event.id)
          setSections((prev) => {
            const next = new Map(prev)
            const cur = next.get(target.sectionId)
            if (cur) next.set(target.sectionId, { ...cur, segments: [...cur.segments, newSeg] })
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
        if (pendingRef.current.has(draftId)) {
          console.error('Publish failed:', err)
          const msg = err instanceof Error ? err.message : String(err)
          setDraftError(
            draftId,
            `Upload failed — recording saved on this device. (${msg.slice(0, 160)})`,
          )
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
    [capabilityRequest, capabilityRequests, issue.issueNumber, myPubkey, recordingEnabled, setDraftError, signer],
  )

  const retryPendingDraft = useCallback((draftId: string) => {
    if (activePublishAttemptsRef.current.has(draftId)) return
    const draft = pendingDrafts.find((item) => item.id === draftId)
    const pending = pendingRef.current.get(draftId)
    if (!draft || !pending || !draftBelongsTo(draft, myPubkey)) return
    if (!canResumeDraft(draft)) {
      setDraftError(
        draftId,
        'Contributor access is still refreshing — wait a moment, then try again.',
      )
      return
    }
    if (!draft.blob || draft.blob.size < 100) {
      setDraftError(draftId, 'Recording data is missing on this device — discard and re-record.')
      return
    }
    const result = { blob: draft.blob, duration: draft.duration, waveform: draft.waveform }
    pendingRef.current.set(draftId, {
      ...pending,
      result,
      descriptor: draft.descriptor,
    })
    setDraftError(draftId, null)
    void handleRecorded(result, pending.target, draftId)
  }, [canResumeDraft, handleRecorded, myPubkey, pendingDrafts, setDraftError])

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
    setDraftError(draftId, null)
    void deleteDraft(draftId).catch((error) => console.warn('Unable to discard recording draft:', error))
  }, [capabilityRequest, capabilityRequests, myPubkey, pendingDrafts, setDraftError])

  const allSegments = useMemo(() => {
    const map = new Map<string, Segment>()
    for (const state of sections.values()) {
      for (const segment of state.segments) map.set(segment.event.id, segment)
    }
    return map
  }, [sections])

  const cut = useEpisodeCut(issue, allSegments, producer)
  const inspectPin = useRef<(() => void) | null>(null)
  const openInspect = (next: NonNullable<typeof inspect>) => {
    inspectPin.current ??= pinWindowScroll()
    setInspect(next)
  }
  useEffect(() => {
    if (inspect) return
    const release = inspectPin.current
    if (!release) return
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        release()
        if (inspectPin.current === release) inspectPin.current = null
      })
    })
    return () => cancelAnimationFrame(id)
  }, [inspect])
  useEffect(() => {
    if (!cut.saving) return
    const unpin = pinWindowScroll()
    return () => {
      window.setTimeout(unpin, 400)
    }
  }, [cut.saving])
  const announcementDone = Boolean(
    cut.status === 'published'
    || cut.content?.release?.completed?.includes('announcement'),
  )
  const [announcementEvent, setAnnouncementEvent] = useState<NostrEvent | null>(null)
  useEffect(() => {
    const mp3 = cut.content?.publishedRss?.mp3Url
    if (!mp3 || !announcementDone) {
      setAnnouncementEvent(null)
      return
    }
    let alive = true
    fetchAnnouncementEvent(mp3, cut.content?.publishedRss?.announcementId).then((event) => {
      if (alive) setAnnouncementEvent(event)
    }).catch(() => {
      if (alive) setAnnouncementEvent(null)
    })
    return () => { alive = false }
  }, [cut.content?.publishedRss?.mp3Url, cut.content?.publishedRss?.announcementId, announcementDone])
  const podstrDone = Boolean(
    cut.status === 'published'
    || cut.content?.release?.completed?.includes('podstr'),
  )
  const [podstrEvent, setPodstrEvent] = useState<NostrEvent | null>(null)
  useEffect(() => {
    if (!podstrDone) {
      setPodstrEvent(null)
      return
    }
    let alive = true
    fetchPodstrEpisode(issue.issueNumber).then((event) => {
      if (alive) setPodstrEvent(event)
    }).catch(() => {
      if (alive) setPodstrEvent(null)
    })
    return () => { alive = false }
  }, [issue.issueNumber, podstrDone])
  // Once the running order is final the episode takes no more recordings, so
  // the page stops offering them rather than collecting notes nobody will hear.
  const episodeOpen = cut.status !== 'cutting' && cut.status !== 'published'
  const canRecordHere = recordingEnabled && episodeOpen

  /** Playback order for a chapter: the saved running order, then late arrivals.
   *  A producer also sees what is currently out of the episode, marked as such. */
  const orderOf = useCallback((sectionId: string, segments: Segment[]) => {
    const section = cut.content?.sections.find((candidate) => candidate.id === sectionId)
    if (!section) return computeSeedOrder(segments)
    return orderTimelineSegments(segments, section.order, producer ? [] : section.excluded)
  }, [cut.content, producer])

  const orders = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const [sectionId, state] of sections) map.set(sectionId, orderOf(sectionId, state.segments))
    return map
  }, [orderOf, sections])

  const episodeNotes = useMemo(
    () => collectEpisodeNotes([...sections.values()].map((state) => state.segments)),
    [sections],
  )

  const queue = useMemo(() => {
    const out: Segment[] = []
    for (const target of allTargets) {
      const state = sections.get(target.id)
      if (!state) continue
      for (const id of orders.get(target.id) ?? []) {
        const seg = state.segments.find((s) => s.event.id === id)
        if (seg) out.push(seg)
      }
    }
    return out
  }, [allTargets, orders, sections])

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
      <main className="timeline">
        <header className="timeline__issue-head">
          <p className="timeline__issue-kicker">Issue</p>
          <h1 className="timeline__issue-title">
            Compass #{issue.issueNumber}
          </h1>
          <p className="timeline__issue-date">
            {new Date(issue.event.created_at * 1000).toLocaleDateString([], {
              month: 'short', day: 'numeric', year: 'numeric',
            })}
          </p>
          {leadProse && <SectionExcerpt section={{ id: '__lead', title: '', items: [{ title: '', body: leadProse }] }} profiles={profiles} />}
        </header>
        {!episodeOpen && (
          <p
            className={`timeline__closed${
              cut.status === 'cutting'
                ? cut.failure ? ' timeline__closed--stopped' : ' timeline__closed--busy'
                : ' timeline__closed--published'
            }`}
            role="status"
          >
            {cut.status === 'published'
              ? 'This episode is published. The voice notes below are what went into it.'
              : 'Recordings are closed.'}
            {cut.status === 'published' && cut.content?.publishedRss?.mp3Url && (
              <>
                {' '}
                <a href={cut.content.publishedRss.mp3Url} target="_blank" rel="noreferrer">
                  Listen to the finished episode
                </a>
              </>
            )}
          </p>
        )}
        {/* The episode's shape is the newsletter's shape: one chapter per
            heading, in the newsletter's order. Say so, and link the event. */}
        <section className="timeline__contents" aria-label="What is in this episode">
          <p className="timeline__contents-lead">
            One chapter per heading in the Compass #{issue.issueNumber} newsletter, in its order.
          </p>
          <ol className="timeline__toc">
            {groups.map(({ group, targets }) => (
              <li key={group.id}>
                {targets.map((target) => {
                  const ids = orders.get(target.id) ?? []
                  const included = ids.filter((id) => cut.stateOf(id) === 'in').length
                  return (
                    <button
                      type="button"
                      key={target.id}
                      className="timeline__toc-item"
                      onClick={() => document
                        .getElementById(`chapter-${target.id}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      <span className="timeline__toc-title">
                        {target.title === group.title ? group.title : `${group.title} · ${target.title}`}
                      </span>
                      <span className="timeline__toc-count">
                        {ids.length === 0
                          ? 'no voice notes'
                          : cut.content
                            ? `${included} of ${ids.length} included`
                            : `${ids.length} voice ${ids.length === 1 ? 'note' : 'notes'}`}
                      </span>
                    </button>
                  )
                })}
              </li>
            ))}
          </ol>

          {episodeNotes.length > 0 && (
            <>
              <p className="timeline__contents-label">Jump to a voice note</p>
              <div className="timeline__community-links">
                {episodeNotes.map((seg, index) => {
                  const author = authorLabel(profiles.get(seg.event.pubkey), seg.event.pubkey)
                  const duration = formatDuration(seg.audio.duration)
                  return (
                    <button
                      type="button"
                      key={seg.event.id}
                      aria-label={`Voice note ${index + 1} from ${author}, ${duration}`}
                      onClick={() => document
                        .getElementById(`voice-note-${seg.event.id}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    >
                      {index + 1}. {author} · {duration}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <p className="timeline__source">
            <button type="button" className="timeline__source-btn" onMouseDown={(event) => event.preventDefault()} onClick={() => openInspect({
              event: issue.event,
              address: issueAddress(issue),
              kindLabel: 'Long-form article (NIP-23) — the Compass newsletter this episode follows.',
              authorLabel: 'Compass',
            })}>
              View the newsletter event
            </button>
            <span> · signed by Compass {`${nip19.npubEncode(issue.event.pubkey).slice(0, 12)}…`}</span>
          </p>
        </section>

        {inspect && (
          <EventInspector
            event={inspect.event}
            address={inspect.address}
            kindLabel={inspect.kindLabel}
            authorLabel={inspect.authorLabel}
            onClose={() => setInspect(null)}
          />
        )}

        {groups.map(({ group, targets }) => (
          <div key={group.id} className="timeline__group">
            <h2 className="timeline__group-title">{group.title}</h2>

            {targets.map((target) => {
              const state = sections.get(target.id)
              const isRecordingHere = recordTarget?.sectionId === target.id
              const isReplyingHere = Boolean(isRecordingHere && recordTarget?.respondingTo)
              const canShowRecorder = recordTarget === null || (isRecordingHere && !isReplyingHere)

              return (
                <section key={target.id} id={`chapter-${target.id}`} className="timeline__section">
                  {target.item && (
                    <SectionExcerpt section={{ id: target.id, title: target.title, items: [target.item] }} profiles={profiles} />
                  )}

                  {cut.editable && (
                    <p className="timeline__chapter-state">
                      {(() => {
                        const included = (orders.get(target.id) ?? []).filter((id) => cut.stateOf(id) === 'in').length
                        const total = orders.get(target.id)?.length ?? 0
                        if (total === 0) return 'Nothing in the cut'
                        return included === 0
                          ? `Nothing included · ${total} to choose from`
                          : `${included} included${total > included ? ` · ${total - included} left out` : ''}`
                      })()}
                    </p>
                  )}

                  {(orders.get(target.id)?.length ?? 0) > 0 && (
                    <div className="timeline__notes">
                      {nestDisplayOrder(state!.segments, orders.get(target.id) ?? []).map(({ id, depth }) => {
                        const seg = state!.segments.find((s) => s.event.id === id)
                        if (!seg) return null
                        const parent = seg.respondingTo
                          ? state!.segments.find((s) => s.event.id === seg.respondingTo)
                          : undefined
                        const isReplyingToThis =
                          recordTarget?.sectionId === target.id && recordTarget?.respondingTo === seg.event.id
                        return (
                          <div
                            key={id}
                            className={`timeline__note${depth > 0 ? ' timeline__note--reply' : ''}`}
                            style={depth > 0 ? { ['--reply-depth' as string]: String(depth) } : undefined}
                          >
                            <VoiceBubble
                              segment={seg}
                              profile={profiles.get(seg.event.pubkey)}
                              parentName={parent
                                ? authorLabel(profiles.get(parent.event.pubkey), parent.event.pubkey)
                                : null}
                              transcript={transcripts.get(id)}
                              isNew={newSegmentIds.has(id)}
                              isOwn={seg.event.pubkey === myPubkey}
                              justPublished={justPublished.has(id)}
                              problem={producer && cut.failure?.segmentId === id ? cut.failure.reason : undefined}
                              onAudioReply={canRecordHere && recordTarget === null ? handleAudioReply : undefined}
                              cut={cut.editable ? {
                                inCut: cut.stateOf(id) === 'in',
                                reviewed: cut.isReviewed(id),
                                eligible: cut.isEligible(seg),
                                canMoveUp: cut.canMove(id, -1),
                                canMoveDown: cut.canMove(id, 1),
                                onToggleInCut: () => cut.toggleInCut(seg),
                                onMoveUp: () => cut.move(id, -1),
                                onMoveDown: () => cut.move(id, 1),
                                onToggleReviewed: () => cut.toggleReviewed(id),
                              } : undefined}
                            />
                            {canRecordHere && isReplyingToThis && (
                              <InlineRecorder
                                onRecorded={(result) => {
                                  setRecordTarget((current) => current?.respondingTo === seg.event.id ? null : current)
                                  void handleRecorded(result, { sectionId: target.id, respondingTo: seg.event.id })
                                }}
                                onCancel={() => setRecordTarget((current) => (
                                  current?.sectionId === target.id && current.respondingTo === seg.event.id ? null : current
                                ))}
                                autoStart
                                idleLabel="Record an audio reply"
                              />
                            )}
                            {pendingDrafts
                              .filter((draft) => draft.target.sectionId === target.id && draft.target.respondingTo === id)
                              .map((draft) => (
                                <UploadBubble
                                  key={draft.id}
                                  draft={draft}
                                  stage={uploadStages.get(draft.id) ?? null}
                                  publishing={publishingDraftIds.has(draft.id)}
                                  error={draftErrors.get(draft.id) ?? null}
                                  canResume={canResumeDraft(draft)}
                                  canDiscard={recordingEnabled && draftBelongsTo(draft, myPubkey)}
                                  onResume={() => retryPendingDraft(draft.id)}
                                  onDiscard={() => discardPendingDraft(draft.id)}
                                />
                              ))}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {pendingDrafts
                    .filter((draft) => draft.target.sectionId === target.id && !draft.target.respondingTo)
                    .map((draft) => (
                      <UploadBubble
                        key={draft.id}
                        draft={draft}
                        stage={uploadStages.get(draft.id) ?? null}
                        publishing={publishingDraftIds.has(draft.id)}
                        error={draftErrors.get(draft.id) ?? null}
                        canResume={canResumeDraft(draft)}
                        canDiscard={recordingEnabled && draftBelongsTo(draft, myPubkey)}
                        onResume={() => retryPendingDraft(draft.id)}
                        onDiscard={() => discardPendingDraft(draft.id)}
                      />
                    ))}

                  {canRecordHere && canShowRecorder && (
                    <div className="timeline__recrow">
                      <InlineRecorder
                        onRecorded={(result) => {
                          setRecordTarget((current) => current?.sectionId === target.id ? null : current)
                          void handleRecorded(result, { sectionId: target.id })
                        }}
                        onCancel={() => setRecordTarget((current) => current?.sectionId === target.id ? null : current)}
                        onArm={() => setRecordTarget({ sectionId: target.id })}
                        idleLabel={(orders.get(target.id)?.length ?? 0) > 0
                          ? 'Add another voice note'
                          : `Add a voice note on ${target.title}`}
                      />
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        ))}

        {producer && (
          <section className="timeline__produce" aria-label="Producing this episode">
            {cut.notice && <p className="produce__notice">{cut.notice}</p>}
            {cut.error && <p className="produce__error" role="alert">{cut.error}</p>}
            {cut.issues.length > 0 && (
              <div className="produce__error" role="alert">
                {cut.issues.map((item, index) => (
                  <div className="produce__issue" key={`${item.sectionId}:${item.source}:${item.segmentId}:${index}`}>
                    <span>{item.reason}: {item.segmentId.slice(0, 12)}… in {item.sectionId}</span>
                  </div>
                ))}
              </div>
            )}

            {cut.editable ? (
              <div className="produce__footer">
                {(!cut.publishReady || cut.dirty) && <p className="produce__next">{cut.nextStep}</p>}
                <div className="produce__actions">
                  <button
                    type="button"
                    className={`btn ${cut.dirty ? 'btn--primary' : ''}`}
                    disabled={!cut.dirty || cut.saving}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={cut.save}
                  >
                    {cut.saving ? 'Saving…' : 'Save running order'}
                  </button>
                </div>
              </div>
            ) : cut.status === 'draft' ? (
              <p className="produce__banner" role="status">
                This key is not on the producer list, so the episode cannot be edited here.
              </p>
            ) : null}

            <ReleaseChecklist
              rows={releaseChecklist({
                content: cut.content,
                manifestEvent: cut.event,
                podstrEvent,
                announcementEvent,
                publishReady: cut.publishReady,
                waitingReason: cut.editable && (!cut.publishReady || cut.dirty) ? '' : cut.nextStep,
                saving: cut.saving,
                canReopen: cut.canReopen,
                canRerun: cut.canRerun,
              })}
              saving={cut.saving}
              onLock={cut.publish}
              onRetry={cut.retryRelease}
              onReopen={cut.reopen}
              onRerun={cut.rerunFrom}
              onInspect={(target: InspectTarget) => {
                const event = target === 'lock'
                  ? cut.event
                  : target === 'podstr'
                    ? podstrEvent
                    : announcementEvent
                if (!event) return
                const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1]
                openInspect({
                  event,
                  kindLabel: target === 'lock'
                    ? 'Episode cut (kind 34200).'
                    : target === 'podstr'
                      ? 'Podcast listing (kind 30054).'
                      : 'Compass note (kind 1).',
                  authorLabel: event.pubkey === COMPASS_PUBKEY ? 'Compass' : 'Producer',
                  address: identifier
                    ? nip19.naddrEncode({
                      kind: event.kind,
                      pubkey: event.pubkey,
                      identifier,
                      relays: RELAYS,
                    })
                    : undefined,
                })
              }}
              onScrollToSegment={(segmentId) => document
                .getElementById(`voice-note-${segmentId}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            />

            <details className="produce__access">
              <summary>Contributor access</summary>
              {/* Producer capability only — the recording grant must never
                  authorize a change to who may contribute. */}
              <WhitelistPanel
                issueNumber={issue.issueNumber}
                issueMarkdown={issue.event.content}
                signer={producer.signer}
                pubkey={producer.pubkey}
                writeRequests={producer.whitelistWriteRequests}
                capabilityRequests={producer.capabilityRequests}
                capabilityRequest={producer.capabilityRequest}
              />
            </details>
          </section>
        )}
      </main>
    </PlaybackProvider>
  )
}
