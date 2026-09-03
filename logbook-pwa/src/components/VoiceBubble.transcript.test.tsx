import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import VoiceBubble, { type BubbleTranscribeControl } from './VoiceBubble'
import { PlaybackProvider } from '../lib/playback'
import type { Segment, TranscriptChunk } from '../types/nostr'

const segment: Segment = {
  event: {
    id: '4'.repeat(64),
    pubkey: '5'.repeat(64),
    created_at: 1_700_000_000,
    kind: 4200,
    tags: [['x', 'a'.repeat(64)], ['section', 'sec-one-32'], ['issue', 'logbook-32']],
    content: '',
    sig: '6'.repeat(128),
  },
  audio: { url: `https://blossom.test/${'a'.repeat(64)}`, sha256: 'a'.repeat(64), mime: 'audio/webm', duration: 3, waveform: [0.5] },
  isIntro: false,
  sectionId: 'sec-one-32',
  issueId: 'logbook-32',
  respondingTo: null,
  alt: null,
}

const chunks: TranscriptChunk[] = [
  { text: 'Logbook transcription check.', timestamp: [0, 2.1] },
  { text: '1, 2, 3.', timestamp: [2.1, 3.0] },
]

function render(
  extra: Partial<Parameters<typeof VoiceBubble>[0]> = {},
  seg: Segment = segment,
) {
  return renderToStaticMarkup(
    <PlaybackProvider segments={[seg]}>
      <VoiceBubble segment={seg} {...extra} />
    </PlaybackProvider>,
  )
}

describe('VoiceBubble transcript', () => {
  it('renders sentence chunks as tap-to-seek transcript', () => {
    const html = render({ transcript: 'Logbook transcription check. 1, 2, 3.', transcriptChunks: chunks })
    expect(html.match(/class="transcript__chunk[^"]*"/g)?.length).toBe(2)
    expect(html).toContain('Logbook transcription check.')
    expect(html).toContain('1, 2, 3.')
  })

  it('renders a plain-text transcript without chunk buttons', () => {
    const html = render({ transcript: 'spoken words' })
    expect(html).toContain('bubble__transcript')
    expect(html).not.toContain('transcript__chunk')
  })
  it('says the automatic transcript is on its way for a fresh upload', () => {
    const fresh = { ...segment, event: { ...segment.event, created_at: Math.floor(Date.now() / 1000) - 30 } }
    const html = render({}, fresh)
    expect(html).toContain('Voice note published — the trusted worker is transcribing it. You may close this browser.')
    expect(html).toContain('transcript-box__pending')
  })

  it('states plainly when an old note has no transcript', () => {
    const html = render()
    expect(html).toContain('No transcript.')
    expect(html).not.toContain('transcript__chunk')
  })
})

describe('VoiceBubble transcribe control', () => {
  const control = (overrides: Partial<BubbleTranscribeControl> = {}): BubbleTranscribeControl => ({
    requested: false,
    busy: false,
    onRetranscribe: () => {},
    ...overrides,
  })

  it('offers Transcribe again inline with sibling cut controls', () => {
    const html = render({ transcript: 'old text', transcribe: control(), cut: {
      inCut: true, reviewed: false, eligible: true, canMoveUp: false, canMoveDown: false,
      onToggleInCut() {}, onMoveUp() {}, onMoveDown() {}, onToggleReviewed() {},
    } })
    expect(html).toContain('Transcribe again')
    expect(html.indexOf('bubble__transcribe')).toBeGreaterThan(html.indexOf('bubble__cut'))
  })

  it('offers Transcribe when the note has no transcript yet', () => {
    const html = render({ transcribe: control() })
    expect(html).toContain('>Transcribe<')
    expect(html).not.toContain('Transcribe again')
  })

  it('disables the button and says what happens next once requested', () => {
    const html = render({ transcript: 'old text', transcribe: control({ requested: true }) })
    expect(html).toContain('Transcribing — the new text appears here in about a minute.')
    expect(html).toContain('disabled')
  })

  it('shows a publish failure next to the button', () => {
    const html = render({ transcribe: control({ error: 'All relays failed to publish' }) })
    expect(html).toContain('All relays failed to publish')
  })

  it('renders no transcribe control for non-producers', () => {
    expect(render()).not.toContain('bubble__transcribe')
  })
})
