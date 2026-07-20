import { useRef, useEffect, useState } from 'react'

interface WordChunk {
  text: string
  timestamp: [number, number | null]
}

interface Props {
  text: string
  chunks?: WordChunk[]
  currentTime?: number
  onWordClick?: (timestamp: number) => void
}

export function TranscriptCard({ text, chunks, currentTime = 0, onWordClick }: Props) {
  const [activeWord, setActiveWord] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

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
    setActiveWord(found)
  }, [currentTime, chunks])

  if (!chunks?.length) {
    return (
      <div style={{
        padding: '12px 16px',
        background: '#111',
        borderRadius: 8,
        color: '#ccc',
        fontSize: 14,
        lineHeight: 1.6,
      }}>
        {text}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        padding: '12px 16px',
        background: '#111',
        borderRadius: 8,
        fontSize: 14,
        lineHeight: 1.8,
        color: '#ccc',
      }}
    >
      {chunks.map((chunk, i) => (
        <span
          key={i}
          onClick={() => onWordClick?.(chunk.timestamp[0])}
          style={{
            cursor: onWordClick ? 'pointer' : 'default',
            background: i === activeWord ? '#7c3aed33' : 'transparent',
            color: i === activeWord ? '#a78bfa' : '#ccc',
            borderRadius: 3,
            padding: '1px 2px',
            transition: 'background 0.1s, color 0.1s',
          }}
        >
          {chunk.text}
        </span>
      ))}
    </div>
  )
}
