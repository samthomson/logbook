/**
 * AdminPanel — drag-to-reorder, include/exclude, reviewed markers, lock episode.
 *
 * Visible only to admin pubkeys (COMPASS_PUBKEY + ADMIN_PUBKEYS).
 * Publishes updated kind 34200 manifest on every change.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CompassIssue, IssueManifest, ManifestContent, Segment, NostrSigner } from '../types/nostr'
import { fetchManifest, updateManifest } from '../lib/manifest'
import { fetchSegmentsByIds, parseSegment } from '../lib/segment'
import AudioPlayer from './AudioPlayer'
import WhitelistPanel from './WhitelistPanel'

interface Props {
  issue: CompassIssue
  signer: NostrSigner
  pubkey: string
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// ─── Sortable segment row ─────────────────────────────────────────────────────

interface SortableSegmentRowProps {
  id: string
  segment: Segment | undefined
  isExcluded: boolean
  isReviewed: boolean
  onToggleExclude: (id: string) => void
  onToggleReviewed: (id: string) => void
}

function SortableSegmentRow({
  id,
  segment,
  isExcluded,
  isReviewed,
  onToggleExclude,
  onToggleReviewed,
}: SortableSegmentRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const [playerOpen, setPlayerOpen] = useState(false)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`admin-segment-row ${isExcluded ? 'admin-segment-row--excluded' : ''}`}
    >
      <span className="admin-segment-row__drag" {...attributes} {...listeners} aria-label="Drag to reorder">
        ⠿
      </span>

      <div className="admin-segment-row__meta">
        <span className="admin-segment-row__pubkey" title={segment?.event.pubkey}>
          {segment?.event.pubkey.slice(0, 8) ?? id.slice(0, 8)}…
        </span>
        {segment && (
          <span className="admin-segment-row__duration">
            {segment.audio.duration.toFixed(1)}s
          </span>
        )}
        {segment?.isIntro && (
          <span className="admin-segment-row__badge admin-segment-row__badge--intro">intro</span>
        )}
      </div>

      <div className="admin-segment-row__controls">
        <button
          className="btn btn--ghost btn--xs"
          onClick={() => setPlayerOpen((v) => !v)}
          aria-label="Preview audio"
        >
          {playerOpen ? '▲' : '▶'}
        </button>

        <label className="admin-segment-row__check" title="Mark reviewed">
          <input
            type="checkbox"
            checked={isReviewed}
            onChange={() => onToggleReviewed(id)}
          />
          ✓
        </label>

        <button
          className={`btn btn--xs ${isExcluded ? 'btn--muted' : 'btn--ghost'}`}
          onClick={() => onToggleExclude(id)}
          title={isExcluded ? 'Include in episode' : 'Exclude from episode'}
        >
          {isExcluded ? 'Include' : 'Exclude'}
        </button>
      </div>

      {playerOpen && segment && (
        <div className="admin-segment-row__player">
          <AudioPlayer
            url={segment.audio.url}
            duration={segment.audio.duration}
            waveform={segment.audio.waveform}
          />
        </div>
      )}
    </div>
  )
}

// ─── AdminPanel ───────────────────────────────────────────────────────────────

export default function AdminPanel({ issue, signer, pubkey }: Props) {
  const [manifest, setManifest] = useState<IssueManifest | null>(null)
  const [segmentMap, setSegmentMap] = useState<Map<string, Segment>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lockConfirm, setLockConfirm] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [section, setSection] = useState<'episode' | 'whitelist'>('episode')

  // Load manifest + segments
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetchManifest(issue.issueNumber)
      .then(async (m) => {
        if (cancelled) return
        setManifest(m)
        if (!m) return

        // Collect all segment ids referenced in manifest
        const allIds = m.content.sections.flatMap((s) => [
          ...s.order,
          ...s.excluded,
        ])
        const uniqueIds = [...new Set(allIds)]

        if (uniqueIds.length === 0) return

        // Fetch segment events
        const events = await fetchSegmentsByIds(uniqueIds)
        if (cancelled) return


        const map = new Map<string, Segment>()
        for (const e of events) {
          const seg = parseSegment(e)
          if (seg) map.set(e.id, seg)
        }
        setSegmentMap(map)
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [issue.issueNumber])

  const save = useCallback(async (content: ManifestContent) => {
    setSaveStatus('saving')
    setSaveError(null)
    try {
      const updated = await updateManifest(issue.issueNumber, content, signer)
      setManifest((prev) => prev ? { ...prev, event: updated, content } : prev)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [issue.issueNumber, signer])

  const handleDragEnd = useCallback((sectionIdx: number) => (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !manifest) return

    setManifest((prev) => {
      if (!prev) return prev
      const sections = [...prev.content.sections]
      const section = { ...sections[sectionIdx] }
      const oldIdx = section.order.indexOf(String(active.id))
      const newIdx = section.order.indexOf(String(over.id))
      if (oldIdx === -1 || newIdx === -1) return prev
      section.order = arrayMove(section.order, oldIdx, newIdx)
      sections[sectionIdx] = section
      const content = { ...prev.content, sections }
      // Fire save async — don't await in state updater
      void save(content)
      return { ...prev, content }
    })
  }, [manifest, save])

  const toggleExclude = useCallback((sectionIdx: number, segId: string) => {
    if (!manifest) return
    const sections = manifest.content.sections.map((s, i) => {
      if (i !== sectionIdx) return s
      const isExcluded = s.excluded.includes(segId)
      return {
        ...s,
        excluded: isExcluded
          ? s.excluded.filter((id) => id !== segId)
          : [...s.excluded, segId],
        order: isExcluded
          ? [...s.order, segId]  // add back to order when re-included
          : s.order.filter((id) => id !== segId),  // remove from order when excluded
      }
    })
    const content = { ...manifest.content, sections }
    setManifest({ ...manifest, content })
    void save(content)
  }, [manifest, save])

  const toggleReviewed = useCallback((sectionIdx: number, segId: string) => {
    if (!manifest) return
    const sections = manifest.content.sections.map((s, i) => {
      if (i !== sectionIdx) return s
      const isReviewed = s.reviewed.includes(segId)
      return {
        ...s,
        reviewed: isReviewed
          ? s.reviewed.filter((id) => id !== segId)
          : [...s.reviewed, segId],
      }
    })
    const content = { ...manifest.content, sections }
    setManifest({ ...manifest, content })
    void save(content)
  }, [manifest, save])

  const toggleSectionExclude = useCallback((sectionIdx: number) => {
    if (!manifest) return
    const sections = manifest.content.sections.map((s, i) => {
      if (i !== sectionIdx) return s
      // Sections don't have their own excluded flag — we repurpose order.length === 0
      // as "excluded" for display. Admin explicitly sets it via a toggle.
      // We track section-level exclusion in a side-channel on each ManifestSection.
      // Since the type doesn't have sectionExcluded, we store it in introEventId === 'excluded'
      // as a sentinel (dirty but avoids a type change for now).
      const nowExcluded = s.introEventId === 'excluded'
      return { ...s, introEventId: nowExcluded ? null : 'excluded' }
    })
    const content = { ...manifest.content, sections }
    setManifest({ ...manifest, content })
    void save(content)
  }, [manifest, save])

  const handleLockEpisode = useCallback(async () => {
    if (!manifest) return
    if (manifest.content.episodeStatus !== 'draft') return
    const content: ManifestContent = {
      ...manifest.content,
      episodeStatus: 'cutting',
    }
    await save(content)
    setLockConfirm(false)
  }, [manifest, save])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  if (loading) {
    return (
      <div className="admin-panel">
        <div className="spinner" aria-label="Loading admin panel" />
      </div>
    )
  }

  const sectionToggle = (
    <div className="admin-panel__tabs" role="tablist">
      <button
        role="tab"
        aria-selected={section === 'episode'}
        className={`btn btn--small ${section === 'episode' ? 'btn--active' : 'btn--ghost'}`}
        onClick={() => setSection('episode')}
      >
        Episode
      </button>
      <button
        role="tab"
        aria-selected={section === 'whitelist'}
        className={`btn btn--small ${section === 'whitelist' ? 'btn--active' : 'btn--ghost'}`}
        onClick={() => setSection('whitelist')}
      >
        Whitelist
      </button>
    </div>
  )

  if (section === 'whitelist') {
    return (
      <div className="admin-panel">
        {sectionToggle}
        <WhitelistPanel
          issueNumber={issue.issueNumber}
          issueMarkdown={issue.event.content}
          signer={signer}
          pubkey={pubkey}
        />
      </div>
    )
  }

  if (!manifest) {
    return (
      <div className="admin-panel">
        {sectionToggle}
        <p className="admin-panel__notice">No manifest found for issue #{issue.issueNumber}. The VPS watcher will create one automatically when it detects the Compass issue.</p>
      </div>
    )
  }

  const status = manifest.content.episodeStatus
  const isLocked = status === 'cutting' || status === 'published'

  return (
    <div className="admin-panel">
      {sectionToggle}
      <div className="admin-panel__header">
        <h2 className="admin-panel__title">Admin — {issue.title}</h2>
        <div className="admin-panel__header-controls">
          <span className={`admin-panel__status admin-panel__status--${status}`}>{status}</span>

          {/* Playback speed */}
          <div className="admin-panel__speed">
            {[1, 1.5, 2].map((rate) => (
              <button
                key={rate}
                className={`btn btn--xs ${playbackRate === rate ? 'btn--active' : 'btn--ghost'}`}
                onClick={() => setPlaybackRate(rate)}
              >
                {rate}×
              </button>
            ))}
          </div>

          {saveStatus === 'saving' && <span className="admin-panel__save-status">Saving…</span>}
          {saveStatus === 'saved' && <span className="admin-panel__save-status admin-panel__save-status--ok">Saved</span>}
          {saveStatus === 'error' && <span className="admin-panel__save-status admin-panel__save-status--err" title={saveError ?? ''}>Save failed</span>}
        </div>
      </div>

      {/* Lock episode button */}
      {!isLocked && (
        <div className="admin-panel__lock-row">
          {!lockConfirm ? (
            <button
              className="btn btn--warning"
              onClick={() => setLockConfirm(true)}
              disabled={saveStatus === 'saving'}
            >
              Lock Episode
            </button>
          ) : (
            <div className="admin-panel__lock-confirm">
              <p>Lock episode for stitching? This marks the episode as <strong>cutting</strong> and cannot be undone.</p>
              <button className="btn btn--danger" onClick={() => void handleLockEpisode()}>
                Yes, lock it
              </button>
              <button className="btn btn--ghost" onClick={() => setLockConfirm(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      {isLocked && (
        <div className="admin-panel__lock-row">
          <span className="admin-panel__locked-badge">
            {status === 'cutting' ? '🔒 Episode locked — ready to stitch' : '✅ Episode published'}
          </span>
          <span className="admin-panel__pubkey-note">Signed as {pubkey.slice(0, 8)}…</span>
        </div>
      )}

      {/* Sections */}
      {manifest.content.sections.map((section, sectionIdx) => {
        const isSectionExcluded = section.introEventId === 'excluded'

        return (
          <div
            key={section.id}
            className={`admin-section ${isSectionExcluded ? 'admin-section--excluded' : ''}`}
          >
            <div className="admin-section__header">
              <h3 className="admin-section__title">{section.title}</h3>
              <div className="admin-section__header-controls">
                <span className="admin-section__count">
                  {section.order.length} in cut, {section.excluded.length} excluded
                </span>
                <button
                  className={`btn btn--xs ${isSectionExcluded ? 'btn--muted' : 'btn--ghost'}`}
                  onClick={() => toggleSectionExclude(sectionIdx)}
                  title={isSectionExcluded ? 'Include section in episode' : 'Exclude entire section'}
                  disabled={isLocked}
                >
                  {isSectionExcluded ? 'Include section' : 'Exclude section'}
                </button>
              </div>
            </div>

            {/* Ordered (in-cut) segments */}
            {section.order.length > 0 && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={isLocked ? undefined : handleDragEnd(sectionIdx)}
              >
                <SortableContext items={section.order} strategy={verticalListSortingStrategy}>
                  <div className="admin-section__order">
                    {section.order.map((segId) => (
                      <SortableSegmentRow
                        key={segId}
                        id={segId}
                        segment={segmentMap.get(segId)}
                        isExcluded={false}
                        isReviewed={section.reviewed.includes(segId)}
                        onToggleExclude={() => !isLocked && toggleExclude(sectionIdx, segId)}
                        onToggleReviewed={() => toggleReviewed(sectionIdx, segId)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {section.order.length === 0 && !isSectionExcluded && (
              <p className="admin-section__empty">No segments in this section yet.</p>
            )}

            {/* Excluded segments */}
            {section.excluded.length > 0 && (
              <div className="admin-section__excluded">
                <p className="admin-section__excluded-label">Excluded:</p>
                {section.excluded.map((segId) => (
                  <SortableSegmentRow
                    key={segId}
                    id={segId}
                    segment={segmentMap.get(segId)}
                    isExcluded={true}
                    isReviewed={section.reviewed.includes(segId)}
                    onToggleExclude={() => !isLocked && toggleExclude(sectionIdx, segId)}
                    onToggleReviewed={() => toggleReviewed(sectionIdx, segId)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
