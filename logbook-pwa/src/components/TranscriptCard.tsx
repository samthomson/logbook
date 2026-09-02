/**
 * TranscriptCard — a note's transcript. Sentence chunks are tap-to-seek and
 * highlight the one playing; plain-text transcripts render as-is.
 */

import { useEffect, useState } from 'react'
import type { TranscriptChunk } from '../types/nostr'

interface Props {
  text: string
  chunks?: TranscriptChunk[]
  currentTime?: number
  onChunkClick?: (timestamp: number) => void
}

export function TranscriptCard({ text, chunks, currentTime = 0, onChunkClick }: Props) {
  const [activeChunk, setActiveChunk] = useState(-1)

  useEffect(() => {
    if (!chunks?.length) return
    let found = -1
    for (let i = 0; i < chunks.length; i++) {
      const [start, end] = chunks[i].timestamp
      if (currentTime >= start && (end === null || currentTime < end)) {
        found = i
        break
      }
    }
    setActiveChunk(found)
  }, [currentTime, chunks])

  if (!chunks?.length) {
    return <p className="bubble__transcript">{text}</p>
  }

  return (
    <p className="bubble__transcript transcript">
      {chunks.map((chunk, i) => (
        <button
          key={i}
          type="button"
          className={`transcript__chunk${i === activeChunk ? ' transcript__chunk--active' : ''}`}
          onClick={() => onChunkClick?.(chunk.timestamp[0])}
        >
          {chunk.text}{' '}
        </button>
      ))}
    </p>
  )
}
