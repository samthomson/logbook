import type { RecordingDraft } from '../lib/drafts'
import { formatDuration } from '../lib/utils'

interface Props {
  draft: RecordingDraft
  stage: string | null
  publishing: boolean
  onResume: () => void
  onDiscard: () => void
}

/** A durable, in-place chat bubble for a take that has not reached relays yet. */
export default function UploadBubble({ draft, stage, publishing, onResume, onDiscard }: Props) {
  const status = publishing
    ? (stage ?? 'Preparing upload')
    : 'Upload paused — recording saved on this device'

  return (
    <div className="bubble bubble--own bubble--upload" role="status" aria-live="polite">
      <div className="bubble__avatar" aria-hidden="true"><span>YO</span></div>
      <div className="bubble__body">
        <div className="bubble__meta">
          <span className="bubble__author">You</span>
          <span className={`bubble__upload-icon ${publishing ? 'bubble__upload-icon--pending' : ''}`} aria-hidden="true">
            {publishing ? '◷' : '!'}
          </span>
        </div>
        <div className="bubble__player bubble__upload-row">
          <span className="bubble__upload-status">{status}</span>
          <span className="bubble__time">-{formatDuration(draft.duration)}</span>
        </div>
        {!publishing && (
          <div className="bubble__upload-actions">
            <button type="button" onClick={onResume}>Resume upload</button>
            <button type="button" onClick={onDiscard}>Discard</button>
          </div>
        )}
      </div>
    </div>
  )
}
