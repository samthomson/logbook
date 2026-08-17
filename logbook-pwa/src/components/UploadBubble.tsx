import { useEffect, useMemo } from 'react'
import type { RecordingDraft } from '../lib/drafts'
import { formatDuration } from '../lib/utils'

interface Props {
  draft: RecordingDraft
  stage: string | null
  publishing: boolean
  error: string | null
  canResume: boolean
  canDiscard: boolean
  onResume: () => void
  onDiscard: () => void
}

const MIN_PREVIEW_BYTES = 100

/** A durable, in-place chat bubble for a take that has not reached relays yet. */
export default function UploadBubble({
  draft, stage, publishing, error, canResume, canDiscard, onResume, onDiscard,
}: Props) {
  const canPreview = draft.blob.size >= MIN_PREVIEW_BYTES
  const previewUrl = useMemo(
    () => (canPreview ? URL.createObjectURL(draft.blob) : null),
    [canPreview, draft.blob],
  )

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const status = publishing
    ? (stage ?? 'Preparing upload')
    : canPreview
      ? 'Not published — saved on this device only'
      : 'Recording unavailable on this device'

  const stateClass = publishing
    ? 'bubble--upload-pending'
    : error
      ? 'bubble--upload-failed'
      : 'bubble--upload-unsaved'

  return (
    <div
      className={`bubble bubble--own bubble--upload ${stateClass}`}
      role="status"
      aria-live="polite"
    >
      <div className="bubble__body">
        <div className="bubble__head">
          <div className="bubble__avatar" aria-hidden="true"><span>YO</span></div>
          <span className="bubble__author">You</span>
          <span className={`bubble__upload-icon ${publishing ? 'bubble__upload-icon--pending' : ''}`} aria-hidden="true">
            {publishing ? '◷' : '!'}
          </span>
        </div>
        {canPreview && previewUrl ? (
          <audio className="bubble__upload-preview" controls preload="metadata" src={previewUrl}>
            <track kind="captions" />
          </audio>
        ) : (
          <p className="bubble__upload-missing">No audio to preview — discard and re-record.</p>
        )}
        <div className="bubble__player bubble__upload-row">
          <span className="bubble__upload-status">{status}</span>
          <span className="bubble__time">{formatDuration(draft.duration)}</span>
        </div>
        {error && !publishing && (
          <p className="bubble__upload-error" role="alert">{error}</p>
        )}
        {!publishing && (
          <div className="bubble__upload-actions">
            <button
              type="button"
              className="btn btn--small btn--primary"
              onClick={onResume}
              disabled={!canResume}
            >
              {canResume ? 'Resume upload' : 'Log in to resume'}
            </button>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={onDiscard}
              disabled={!canDiscard}
            >
              Discard
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
