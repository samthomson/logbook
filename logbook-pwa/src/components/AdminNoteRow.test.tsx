import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceRow } from '../lib/admin-workspace'
import { AdminNoteRow } from './AdminNoteRow'

const row: WorkspaceRow = {
  rowKey: `section:included:${'1'.repeat(64)}`,
  segmentId: '1'.repeat(64),
  segment: {
    event: {
      id: '1'.repeat(64),
      pubkey: '2'.repeat(64),
      created_at: 1_700_000_000,
      kind: 4200,
      tags: [['section', 'section']],
      content: '{}',
      sig: '3'.repeat(128),
    },
    audio: {
      url: 'https://audio.example/fixture.webm',
      sha256: '4'.repeat(64),
      mime: 'audio/webm',
      duration: 12,
      waveform: [0.2, 0.8],
    },
    isIntro: false,
    sectionId: 'section',
    issueId: 'logbook-32',
    respondingTo: null,
    alt: null,
  },
  state: 'included',
  isNew: false,
  isIntro: false,
  reviewed: false,
  unavailable: false,
}

function render(reviewed = false) {
  const onToggleReviewed = vi.fn()
  const html = renderToStaticMarkup(
    <DndContext>
      <SortableContext items={[row.segmentId]} strategy={verticalListSortingStrategy}>
        <AdminNoteRow
          row={{ ...row, reviewed }}
          editable
          sortable
          canMoveUp={false}
          canMoveDown={false}
          onInclude={() => {}}
          onExclude={() => {}}
          onMoveUp={() => {}}
          onMoveDown={() => {}}
          onToggleReviewed={onToggleReviewed}
        />
      </SortableContext>
    </DndContext>,
  )
  return { html, onToggleReviewed }
}

describe('AdminNoteRow review workspace controls', () => {
  it('shows review state on the compact row', () => {
    const pending = render(false).html
    const reviewed = render(true).html

    expect(pending).toContain('needs review')
    expect(reviewed).toContain('reviewed')
  })
})
