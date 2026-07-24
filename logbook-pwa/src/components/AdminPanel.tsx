/** Mobile-first chapter-oriented episode workspace. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { nip19 } from 'nostr-tools'
import { COMPASS_PUBKEY } from '../config'
import type { CompassIssue, IssueManifest, ManifestContent, NostrSigner, Segment } from '../types/nostr'
import { createAdminSaveController } from '../lib/admin-save'
import { areRequestScopesCurrent, type LatestRequestGuard } from '../lib/latest-request'
import {
  canEditManifest,
  canLockEpisode,
  includeAllChapters,
  moveSectionRecording,
  reorderSection,
  toggleSegmentExcluded,
} from '../lib/admin-state'
import { collectWhitelistedTimeline } from '../lib/admin-timeline'
import {
  buildRecordingTargets,
  includeInventorySegment,
  isManifestDirty,
  projectAdminWorkspace,
  removeManifestReference,
  validateManifestReferences,
} from '../lib/admin-workspace'
import { buildInitialManifest, fetchManifest, updateManifest } from '../lib/manifest'
import { fetchProfiles, type Profile } from '../lib/profiles'
import { fetchSegmentsForIssue, fetchTranscripts, parseSegment } from '../lib/segment'
import { AdminNoteRow } from './AdminNoteRow'
import WhitelistPanel from './WhitelistPanel'
import './AdminWorkspace.css'

interface Props {
  issue: CompassIssue
  signer: NostrSigner
  pubkey: string
  contributorPubkeys: ReadonlySet<string>
  manifestWriteRequests: LatestRequestGuard
  whitelistWriteRequests: LatestRequestGuard
  capabilityRequests: LatestRequestGuard
  capabilityRequest: number | null
}

function issueReference(issue: CompassIssue): string {
  const identifier = issue.event.tags.find((tag) => tag[0] === 'd')?.[1]
  if (!identifier) throw new Error('The Compass issue has no addressable identifier.')
  return nip19.naddrEncode({ kind: issue.event.kind, pubkey: issue.event.pubkey, identifier })
}

export default function AdminPanel({
  issue,
  signer,
  pubkey,
  contributorPubkeys,
  manifestWriteRequests,
  whitelistWriteRequests,
  capabilityRequests,
  capabilityRequest,
}: Props) {
  const manifestCapabilityRef = useRef({ issueNumber: issue.issueNumber, pubkey, signer })
  manifestCapabilityRef.current = { issueNumber: issue.issueNumber, pubkey, signer }
  const targets = useMemo(() => buildRecordingTargets(issue), [issue])
  const initialDraft = useCallback(() => buildInitialManifest(
    issue.issueNumber,
    issueReference(issue),
    targets,
  ), [issue, targets])

  const [baseManifest, setBaseManifest] = useState<IssueManifest | null>(null)
  const [draft, setDraft] = useState<ManifestContent | null>(null)
  const [inventory, setInventory] = useState<Map<string, Segment>>(new Map())
  const [transcripts, setTranscripts] = useState<Map<string, string>>(new Map())
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadGeneration = useRef(0)

  const saveController = useMemo(() => createAdminSaveController({
    fetchLatest: () => fetchManifest(issue.issueNumber),
    publish: (content, previousEventId, previousCreatedAt, assertActive) => updateManifest(
      issue.issueNumber,
      content,
      signer,
      undefined,
      previousEventId,
      previousCreatedAt,
      assertActive,
    ),
  }), [issue.issueNumber, signer])

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    setLoading(true)
    setError(null)
    setBaseManifest(null)
    setDraft(null)
    setInventory(new Map())
    setTranscripts(new Map())
    setProfiles(new Map())
    try {
      const [manifest, grouped] = await Promise.all([
        fetchManifest(issue.issueNumber),
        fetchSegmentsForIssue(`logbook-${issue.issueNumber}`),
      ])
      const parsedLists = [...grouped.values()].map((events) => events.flatMap((event) => {
        const parsed = parseSegment(event)
        return parsed ? [parsed] : []
      }))
      const allowed = new Set([...contributorPubkeys, COMPASS_PUBKEY])
      const trustedInventory = collectWhitelistedTimeline(parsedLists, allowed)
      const inventoryMap = new Map(trustedInventory.map((segment) => [segment.event.id, segment]))
      if (generation !== loadGeneration.current) return
      setBaseManifest(manifest)
      setDraft(includeAllChapters(manifest?.content ?? initialDraft(), buildRecordingTargets(issue)))
      setInventory(inventoryMap)

      const [trustedTranscripts, loadedProfiles] = await Promise.all([
        fetchTranscripts(trustedInventory),
        fetchProfiles(trustedInventory.map((segment) => segment.event.pubkey)),
      ])
      if (generation !== loadGeneration.current) return
      setTranscripts(new Map([...trustedTranscripts].map(([id, transcript]) => [id, transcript.text])))
      setProfiles(loadedProfiles)
    } catch (cause) {
      if (generation !== loadGeneration.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [contributorPubkeys, initialDraft, issue])

  useEffect(() => { void load() }, [load])

  const editable = Boolean(draft && canEditManifest(draft, pubkey))
  const dirty = Boolean(draft && (baseManifest
    ? isManifestDirty(baseManifest.content, draft)
    : true))
  const workspace = useMemo(() => draft
    ? projectAdminWorkspace(issue, draft, inventory)
    : [], [draft, inventory, issue])
  const validation = useMemo(() => draft
    ? validateManifestReferences(draft, inventory)
    : { canLock: false, issues: [] }, [draft, inventory])
  const missingChapterTitles = useMemo(() => draft
    ? draft.sections
      .filter((section) => !section.order.some((id) => !section.excluded.includes(id)))
      .map((section) => section.title)
    : [], [draft])
  const everyChapterReady = Boolean(draft && canLockEpisode(draft))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const save = useCallback(async (content: ManifestContent, message: string) => {
    const request = manifestWriteRequests.begin()
    const capability = { issueNumber: issue.issueNumber, pubkey, signer }
    const isActive = () => {
      const current = manifestCapabilityRef.current
      return areRequestScopesCurrent(
        capabilityRequests,
        capabilityRequest,
        manifestWriteRequests,
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
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const acknowledged = await saveController.save(baseManifest, content, assertActive)
      if (!isActive()) return
      setBaseManifest(acknowledged)
      setDraft(acknowledged.content)
      setNotice(message)
    } catch (cause) {
      if (!isActive()) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (isActive()) setSaving(false)
    }
  }, [baseManifest, capabilityRequest, capabilityRequests, issue.issueNumber, manifestWriteRequests, pubkey, saveController, signer])

  const handleSave = () => {
    if (draft && editable && dirty) void save(draft, 'Episode saved and relay revision verified.')
  }

  const handleLock = () => {
    if (!draft || !editable || dirty || !validation.canLock || !everyChapterReady) return
    void save({ ...draft, episodeStatus: 'cutting' }, 'Episode locked for the trusted stitcher.')
  }

  const handleDragEnd = (chapterIndex: number, event: DragEndEvent) => {
    if (!draft || !editable || !event.over || event.active.id === event.over.id) return
    const sectionIndex = workspace[chapterIndex]?.sectionIndex
    if (sectionIndex === null || sectionIndex === undefined) return
    setDraft(reorderSection(draft, sectionIndex, String(event.active.id), String(event.over.id)))
  }

  if (loading) return <div className="admin-workspace__state">Loading episode workspace…</div>
  if (!draft) return (
    <div className="admin-workspace__state">
      <p>{error ?? 'Episode workspace unavailable.'}</p>
      <button type="button" className="btn" onClick={() => void load()}>Retry</button>
    </div>
  )

  return (
    <div className="admin-workspace">
      <header className="admin-workspace__toolbar">
        <div>
          <p className="admin-workspace__eyebrow">Episode {issue.issueNumber}</p>
          <h2>{issue.title}</h2>
          <p className="admin-workspace__summary">
            {workspace.length} chapters · {inventory.size} recordings · {transcripts.size} transcripts
          </p>
        </div>
        <div className="admin-workspace__actions">
          <span className={`episode-status episode-status--${draft.episodeStatus}`}>{draft.episodeStatus}</span>
          {editable && (
            <>
              <button type="button" className="btn" disabled={!dirty || saving} onClick={handleSave}>
                {saving ? 'Saving…' : baseManifest ? 'Save episode' : 'Create episode'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={dirty || saving || !validation.canLock || !everyChapterReady}
                onClick={handleLock}
                title={dirty
                  ? 'Save changes before locking'
                  : !everyChapterReady
                    ? 'Record every newsletter chapter before locking'
                    : validation.canLock
                      ? 'Lock the verified cut'
                      : 'Resolve active recording issues first'}
              >
                Lock for release
              </button>
            </>
          )}
        </div>
      </header>

      {!editable && (
        <p className="admin-workspace__banner">
          Read-only — only the Compass signer can change a draft episode.
        </p>
      )}
      {notice && <p className="admin-workspace__notice">{notice}</p>}
      {missingChapterTitles.length > 0 && (
        <p className="admin-workspace__banner" role="status">
          {missingChapterTitles.length} {missingChapterTitles.length === 1 ? 'chapter needs' : 'chapters need'} a recording before release.
        </p>
      )}
      {(error || validation.issues.length > 0) && (
        <div className="admin-workspace__error" role="alert">
          {error && <p>{error}</p>}
          {validation.issues.map((item, index) => (
            <div className="admin-workspace__issue" key={`${item.sectionId}:${item.source}:${item.segmentId}:${index}`}>
              <span>
                {item.reason}: {item.segmentId.slice(0, 12)}… in {item.sectionId}
                {!item.active && ' (not an active stitch input)'}
              </span>
              {editable && !item.active && (
                <button
                  type="button"
                  className="btn btn--ghost btn--xs"
                  onClick={() => setDraft(removeManifestReference(draft, item))}
                >
                  Remove reference
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <main className="episode-chapters">
        {workspace.map((chapter, chapterIndex) => {
          const included = chapter.rows.filter((row) => row.state === 'included')
          const notIncluded = chapter.rows.filter((row) => row.state !== 'included')
          return (
            <section className="episode-chapter" key={`${chapter.id}:${chapter.sectionIndex ?? 'inventory'}`}>
              <header className="episode-chapter__header">
                <div>
                  <h3>{chapter.title}</h3>
                  <span>
                    {included.length === 1 ? '1 recording' : `${included.length} recordings`}
                    {notIncluded.length > 0 && ` · ${notIncluded.length} available`}
                  </span>
                </div>
              </header>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => handleDragEnd(chapterIndex, event)}>
                <SortableContext items={included.map((row) => row.segmentId)} strategy={verticalListSortingStrategy}>
                  <div className="episode-chapter__notes">
                    {included.map((row, rowIndex) => (
                      <AdminNoteRow
                        key={row.rowKey}
                        row={row}
                        profile={row.segment ? profiles.get(row.segment.event.pubkey) : null}
                        transcript={transcripts.get(row.segmentId)}
                        editable={editable}
                        sortable={editable && !row.isIntro}
                        canMoveUp={editable && !row.isIntro && rowIndex > (included[0]?.isIntro ? 1 : 0)}
                        canMoveDown={editable && !row.isIntro && rowIndex < included.length - 1}
                        onInclude={() => {}}
                        onExclude={() => setDraft(toggleSegmentExcluded(draft, chapter.sectionIndex!, row.segmentId))}
                        onMoveUp={() => setDraft(moveSectionRecording(draft, chapter.sectionIndex!, row.segmentId, -1))}
                        onMoveDown={() => setDraft(moveSectionRecording(draft, chapter.sectionIndex!, row.segmentId, 1))}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {notIncluded.length > 0 && (
                <div className="episode-chapter__not-in">
                  <div className="episode-chapter__divider"><span>Available recordings</span></div>
                  {notIncluded.map((row) => (
                    <AdminNoteRow
                      key={row.rowKey}
                      row={row}
                      profile={row.segment ? profiles.get(row.segment.event.pubkey) : null}
                      transcript={transcripts.get(row.segmentId)}
                      editable={editable}
                      sortable={false}
                      canMoveUp={false}
                      canMoveDown={false}
                      onInclude={() => {
                        if (row.segment) setDraft(includeInventorySegment(draft, targets, row.segment))
                      }}
                      onExclude={() => {
                        if (chapter.sectionIndex !== null) {
                          setDraft(toggleSegmentExcluded(draft, chapter.sectionIndex, row.segmentId))
                        }
                      }}
                      onMoveUp={() => {}}
                      onMoveDown={() => {}}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </main>

      <details className="admin-workspace__access">
        <summary>Contributor access</summary>
        <WhitelistPanel
          issueNumber={issue.issueNumber}
          issueMarkdown={issue.event.content}
          signer={signer}
          pubkey={pubkey}
          writeRequests={whitelistWriteRequests}
          capabilityRequests={capabilityRequests}
          capabilityRequest={capabilityRequest}
        />
      </details>
    </div>
  )
}
