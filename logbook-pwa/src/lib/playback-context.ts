import { createContext, useContext } from 'react'

export interface PlaybackState {
  currentId: string | null
  playing: boolean
  currentTime: number
  duration: number
  loading: boolean
  /** True when autoplay policy blocked playback; user must tap to resume. */
  blocked: boolean
  play: (segmentId: string) => void
  pause: () => void
  toggle: (segmentId: string) => void
  seek: (seconds: number) => void
}

export const PlaybackContext = createContext<PlaybackState | null>(null)

export function usePlayback(): PlaybackState {
  const context = useContext(PlaybackContext)
  if (!context) throw new Error('usePlayback must be used inside <PlaybackProvider>')
  return context
}
