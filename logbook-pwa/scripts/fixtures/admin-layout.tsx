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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AdminNoteRow } from '../../src/components/AdminNoteRow'
import type { Profile } from '../../src/lib/profiles'
import type { WorkspaceRow } from '../../src/lib/admin-workspace'
import type { Segment } from '../../src/types/nostr'

function fixtureRow(index: number): WorkspaceRow {
  const isIntro = index === 1
  const segmentId = index.toString(16).padStart(64, '0')
  const pubkey = (index + 10).toString(16).padStart(64, '0')
  const segment: Segment = {
    event: {
      id: segmentId,
      pubkey,
      created_at: 1_700_000_000 + index,
      kind: 4200,
      tags: [],
      content: '',
      sig: '0'.repeat(128),
    },
    audio: {
      url: 'data:audio/wav;base64,UklGRg==',
      sha256: 'f'.repeat(64),
      mime: 'audio/wav',
      duration: 123.4,
      waveform: [],
    },
    isIntro,
    sectionId: 'chapter-1',
    issueId: 'logbook-32',
    respondingTo: null,
    alt: null,
  }
  return {
    rowKey: `included:${segmentId}`,
    segmentId,
    segment,
    state: 'included',
    isNew: index === 1,
    isIntro,
    reviewed: false,
    unavailable: false,
  }
}

const initialRows = [fixtureRow(1), fixtureRow(2), fixtureRow(3)]
const profiles = new Map<string, Profile>(initialRows.map((row, index) => [
  row.segment!.event.pubkey,
  { pubkey: row.segment!.event.pubkey, name: `Contributor with a very long display name ${index + 1}`, picture: null },
]))
const noop = () => {}

function moveRowAt(rows: WorkspaceRow[], from: number, to: number): WorkspaceRow[] {
  const firstMovable = rows[0]?.isIntro ? 1 : 0
  return from >= firstMovable && to >= firstMovable && to < rows.length
    ? arrayMove(rows, from, to)
    : rows
}

export function LayoutHarness() {
  const [rows, setRows] = useState(initialRows)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setRows((current) => {
      const from = current.findIndex((row) => row.segmentId === active.id)
      const to = current.findIndex((row) => row.segmentId === over.id)
      return moveRowAt(current, from, to)
    })
  }
  const moveRow = (segmentId: string, offset: -1 | 1) => {
    setRows((current) => {
      const from = current.findIndex((row) => row.segmentId === segmentId)
      return moveRowAt(current, from, from + offset)
    })
  }

  return (
    <div className="app app--admin">
      <header className="app-header">
        <span className="app-title">Logbook</span>
        <nav className="app-nav">
          <button className="btn btn--ghost btn--small">Timeline</button>
          <button className="btn btn--ghost btn--small">Episodes</button>
          <button className="btn btn--ghost btn--small">Admin</button>
        </nav>
        <button className="btn btn--ghost btn--small app-logout">Log out</button>
      </header>
      <div className="app-body">
        <div className="admin-workspace">
          <header className="admin-workspace__toolbar">
            <div>
              <p className="admin-workspace__eyebrow">Episode 32</p>
              <h2>A newsletter title that must stay within the mobile viewport</h2>
              <p className="admin-workspace__summary">29 chapters · 8 recordings · 8 transcripts</p>
            </div>
            <div className="admin-workspace__actions">
              <span className="episode-status">draft</span>
              <button className="btn">Save episode</button>
              <button className="btn btn--ghost">Lock for release</button>
            </div>
          </header>
          <main className="episode-chapters">
            <section className="episode-chapter">
              <header className="episode-chapter__header">
                <div>
                  <h3>Long newsletter chapter heading for mobile review</h3>
                  <span>3 recordings</span>
                </div>
              </header>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={rows.map((row) => row.segmentId)} strategy={verticalListSortingStrategy}>
                  <div className="episode-chapter__notes">
                    {rows.map((row, index) => (
                      <AdminNoteRow
                        key={row.rowKey}
                        row={row}
                        profile={profiles.get(row.segment!.event.pubkey)}
                        transcript={`A trusted transcript ${'unbroken'.repeat(20)}`}
                        editable
                        sortable={!row.isIntro}
                        canMoveUp={!row.isIntro && index > (rows[0]?.isIntro ? 1 : 0)}
                        canMoveDown={!row.isIntro && index < rows.length - 1}
                        onInclude={noop}
                        onExclude={noop}
                        onMoveUp={() => moveRow(row.segmentId, -1)}
                        onMoveDown={() => moveRow(row.segmentId, 1)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LayoutHarness />
  </StrictMode>,
)
