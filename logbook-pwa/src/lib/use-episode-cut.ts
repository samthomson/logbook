/**
 * The episode's cut, on the episode page.
 *
 * One page per episode: contributors record into it, producers decide what goes
 * in and publish it. This hook owns the manifest behind that page — the saved
 * revision, the producer's unsaved edits, and the two write actions. Readers get
 * the saved manifest only, which is what orders the notes they see.
 *
 * Every write stays bound to the capability that authorized it: the same issue,
 * the same producer key, the same signer, and a current access refresh. A
 * revoked capability throws rather than publishing under stale authority.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CompassIssue,
  EpisodeStatus,
  IssueManifest,
  ManifestContent,
  ManifestFailure,
  NostrSigner,
  Segment,
} from '../types/nostr'
import { createAdminSaveController } from './admin-save'
import { areRequestScopesCurrent, type LatestRequestGuard } from './latest-request'
import {
  canEditManifest,
  canLockEpisode,
  includeAllChapters,
  moveSectionRecording,
  toggleSegmentExcluded,
  toggleSegmentReviewed,
} from './admin-state'
import {
  buildRecordingTargets,
  includeInventorySegment,
  isManifestDirty,
  validateManifestReferences,
  type WorkspaceReferenceIssue,
} from './admin-workspace'
import { issueAddress } from './compass'
import { buildInitialManifest, fetchManifest, subscribeManifest, updateManifest } from './manifest'
import { selectNewestManifestRevision } from './manifest-revision'
import {
  canMoveInCut,
  cutStateOf,
  isCutEligible,
  isReviewedInCut,
  sectionIndexHolding,
  type CutState,
} from './cut-rules'

/** Everything a producer needs to write, or absent for everyone else. */
export interface ProducerContext {
  signer: NostrSigner
  pubkey: string
  /** Compass plus the keys on the Compass-signed producer list. */
  producerPubkeys: ReadonlySet<string>
  /** Whose recordings may enter the cut at all. */
  contributorPubkeys: ReadonlySet<string>
  manifestWriteRequests: LatestRequestGuard
  whitelistWriteRequests: LatestRequestGuard
  /** The producer capability, never the recording one. */
  capabilityRequests: LatestRequestGuard
  capabilityRequest: number | null
  onPublished?: () => void
}

export type { CutState }

export interface EpisodeCut {
  /** Live content: a producer's working copy, or the saved revision. */
  content: ManifestContent | null
  status: EpisodeStatus | null
  loading: boolean
  editable: boolean
  dirty: boolean
  saving: boolean
  notice: string | null
  error: string | null
  nextStep: string
  publishReady: boolean
  /** Why the worker handed this episode back, if it did. */
  failure: ManifestFailure | null
  issues: WorkspaceReferenceIssue[]
  stateOf: (segmentId: string) => CutState
  isReviewed: (segmentId: string) => boolean
  isEligible: (segment: Segment) => boolean
  canMove: (segmentId: string, direction: -1 | 1) => boolean
  toggleInCut: (segment: Segment) => void
  move: (segmentId: string, direction: -1 | 1) => void
  toggleReviewed: (segmentId: string) => void
  save: () => void
  publish: () => void
  retryRelease: () => void
  reload: () => void
}

export function useEpisodeCut(
  issue: CompassIssue,
  segments: ReadonlyMap<string, Segment>,
  producer: ProducerContext | null,
): EpisodeCut {
  const [base, setBase] = useState<IssueManifest | null>(null)
  const [draft, setDraft] = useState<ManifestContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)

  const targets = useMemo(() => buildRecordingTargets(issue), [issue])
  const signer = producer?.signer ?? null
  const pubkey = producer?.pubkey ?? null
  const producing = producer !== null
  const capabilityRef = useRef({ issueNumber: issue.issueNumber, pubkey, signer })
  capabilityRef.current = { issueNumber: issue.issueNumber, pubkey, signer }

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setNotice(null)
    fetchManifest(issue.issueNumber)
      .then((manifest) => {
        if (!alive) return
        setBase(manifest)
        // A producer always gets every newsletter chapter to work with; a reader
        // gets exactly what was signed, or nothing when no cut exists yet.
        setDraft(producing
          ? includeAllChapters(
            manifest?.content ?? buildInitialManifest(issue.issueNumber, issueAddress(issue), targets),
            targets,
          )
          : manifest?.content ?? null)
      })
      .catch((cause: unknown) => {
        if (!alive) return
        setBase(null)
        setDraft(null)
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // The producer object is rebuilt every render; the load only depends on who
    // is producing, not on the identity of that wrapper.
  }, [issue, targets, producing, pubkey, reloads])

  // Live revisions: the worker publishes a hand-back or a release while the page
  // is open, and unsaved producer edits must survive that arriving.
  const baseRef = useRef<IssueManifest | null>(null)
  baseRef.current = base
  const dirtyRef = useRef(false)
  useEffect(() => {
    return subscribeManifest(issue.issueNumber, (incoming) => {
      const current = baseRef.current
      if (current && selectNewestManifestRevision([incoming.event, current.event])?.id !== incoming.event.id) return
      baseRef.current = incoming
      setBase(incoming)
      if (dirtyRef.current) {
        setNotice('This episode changed on the relay. Your unsaved changes are still here; saving will check for a conflict.')
        return
      }
      setDraft(producing ? includeAllChapters(incoming.content, targets) : incoming.content)
    })
  }, [issue.issueNumber, producing, targets])

  const contributorPubkeys = producer?.contributorPubkeys ?? null
  const isEligible = useCallback(
    (segment: Segment) => isCutEligible(segment, contributorPubkeys),
    [contributorPubkeys],
  )

  // Validation must judge the manifest against recordings that may legitimately
  // be in it, so a reference to a non-contributor reads as unavailable.
  const eligibleSegments = useMemo(() => {
    const map = new Map<string, Segment>()
    for (const [id, segment] of segments) if (isEligible(segment)) map.set(id, segment)
    return map
  }, [segments, isEligible])

  const editable = Boolean(draft && producer && canEditManifest(draft, producer.pubkey, producer.producerPubkeys))
  const dirty = Boolean(producer && draft && (base ? isManifestDirty(base.content, draft) : true))
  dirtyRef.current = dirty
  const validation = useMemo(() => draft
    ? validateManifestReferences(draft, eligibleSegments)
    : { canLock: false, issues: [] as WorkspaceReferenceIssue[] }, [draft, eligibleSegments])
  const everyChapterReady = Boolean(draft && canLockEpisode(draft))
  const publishReady = editable && !dirty && validation.canLock && everyChapterReady

  const save = useCallback(async (content: ManifestContent, message: string) => {
    if (!producer || !signer || !pubkey) return
    const request = producer.manifestWriteRequests.begin()
    const isActive = () => {
      const current = capabilityRef.current
      return areRequestScopesCurrent(
        producer.capabilityRequests,
        producer.capabilityRequest,
        producer.manifestWriteRequests,
        request,
      )
        && current.issueNumber === issue.issueNumber
        && current.pubkey === pubkey
        && current.signer === signer
    }
    const assertActive = () => {
      if (!isActive()) throw new Error('Producer capability was revoked')
    }
    if (!isActive()) return

    const controller = createAdminSaveController({
      fetchLatest: () => fetchManifest(issue.issueNumber),
      publish: (next, previousEventId, previousCreatedAt, assert) => updateManifest(
        issue.issueNumber,
        next,
        signer,
        undefined,
        previousEventId,
        previousCreatedAt,
        assert,
      ),
    })

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const acknowledged = await controller.save(base, content, assertActive)
      if (!isActive()) return
      setBase(acknowledged)
      setDraft(acknowledged.content)
      setNotice(message)
      producer.onPublished?.()
    } catch (cause) {
      if (!isActive()) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isActive()) setSaving(false)
    }
  }, [base, issue.issueNumber, producer, pubkey, signer])

  const mutate = useCallback((update: (content: ManifestContent) => ManifestContent) => {
    if (!editable) return
    setDraft((current) => (current ? update(current) : current))
  }, [editable])

  const stateOf = useCallback((segmentId: string) => cutStateOf(draft, segmentId), [draft])

  const toggleInCut = useCallback((segment: Segment) => {
    if (!editable) return
    if (!isEligible(segment)) return
    mutate((content) => {
      const holding = sectionIndexHolding(content, segment.event.id)
      if (holding >= 0) return toggleSegmentExcluded(content, holding, segment.event.id)
      return includeInventorySegment(content, targets, segment)
    })
  }, [editable, isEligible, mutate, targets])

  const move = useCallback((segmentId: string, direction: -1 | 1) => {
    mutate((content) => {
      const holding = sectionIndexHolding(content, segmentId)
      return holding < 0 ? content : moveSectionRecording(content, holding, segmentId, direction)
    })
  }, [mutate])

  const canMove = useCallback(
    (segmentId: string, direction: -1 | 1) => editable && canMoveInCut(draft, segmentId, direction),
    [draft, editable],
  )

  const toggleReviewed = useCallback((segmentId: string) => {
    mutate((content) => {
      const holding = sectionIndexHolding(content, segmentId)
      return holding < 0 ? content : toggleSegmentReviewed(content, holding, segmentId)
    })
  }, [mutate])

  const isReviewed = useCallback((segmentId: string) => isReviewedInCut(draft, segmentId), [draft])

  const nextStep = !base
    ? 'Nothing saved yet. Save the running order to start work on this episode.'
    : dirty
      ? 'Unsaved changes. Saving stores the running order — nothing is published and you can keep editing.'
      : !everyChapterReady
        ? 'Nothing in the cut.'
        : !validation.canLock
          ? 'Resolve the flagged recordings before you can publish.'
          : 'Running order saved. Publishing makes the audio file and the podcast feed. It cannot be undone.'

  return {
    content: draft,
    status: draft?.episodeStatus ?? null,
    loading,
    editable,
    dirty,
    saving,
    notice,
    error,
    nextStep,
    publishReady,
    failure: base?.content.lastFailure ?? null,
    issues: validation.issues,
    stateOf,
    isReviewed,
    isEligible,
    canMove,
    toggleInCut,
    move,
    toggleReviewed,
    save: () => {
      if (draft && editable && dirty) void save(draft, 'Running order saved and verified on the relay.')
    },
    publish: () => {
      if (!draft || !publishReady) return
      // A new attempt owns its own outcome: the previous failure goes with it.
      void save(
        { ...draft, episodeStatus: 'cutting', lastFailure: null, release: undefined },
        'The worker is making the audio and the feed.',
      )
    },
    retryRelease: () => {
      if (!base || base.content.episodeStatus !== 'cutting') return
      const completed = base.content.release?.completed ?? []
      void save(
        {
          ...base.content,
          lastFailure: null,
          release: completed.length > 0 ? { completed } : undefined,
        },
        'Trying the remaining publish steps again.',
      )
    },
    reload: () => setReloads((count) => count + 1),
  }
}
