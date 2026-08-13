import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from './App'
import IssueTimeline from './components/IssueTimeline'
import UploadBubble from './components/UploadBubble'
import type { CompassIssue } from './types/nostr'
import type { RecordingDraft } from './lib/drafts'
import { createLatestRequestGuard } from './lib/latest-request'

const fixtureIssue: CompassIssue = {
  issueNumber: 32,
  title: 'Fixture Compass issue',
  event: {
    id: '1'.repeat(64),
    pubkey: '2'.repeat(64),
    created_at: 1_700_000_000,
    kind: 30_023,
    tags: [['d', 'newsletter-32']],
    content: '## Lead stories\n### Public chapter\nPublished content',
    sig: '3'.repeat(128),
  },
  sections: [{
    id: 'sec-lead-stories-32',
    title: 'Lead stories',
    items: [{ id: 'sec-lead-stories-public-chapter-32', title: 'Public chapter', body: 'Published content' }],
  }],
}

const fixtureDraft: RecordingDraft = {
  id: 'draft-1',
  issueNumber: 32,
  ownerPubkey: 'a'.repeat(64),
  target: { sectionId: 'sec-lead-stories-public-chapter-32', respondingTo: null },
  blob: new Blob(['voice'], { type: 'audio/webm' }),
  duration: 1,
  waveform: [0.5],
  descriptor: null,
  updatedAt: 1_700_000_000_000,
}

describe('public application shell', () => {
  it('starts loading the public timeline without requiring authentication', () => {
    const html = renderToStaticMarkup(<App />)

    expect(html).toContain('Loading issue…')
    expect(html).toContain('Log in')
    expect(html).not.toContain('Advanced options')
  })

  it('keeps recording controls hidden when no signer is present', () => {
    const capabilityRequests = createLatestRequestGuard()
    const html = renderToStaticMarkup(
      <IssueTimeline
        issue={fixtureIssue}
        signer={null}
        myPubkey={null}
        canRecord
        capabilityRequests={capabilityRequests}
        capabilityRequest={null}
      />,
    )

    expect(html).toContain('Public chapter')
    expect(html).not.toContain('Record a voice note')
  })

  it('keeps a saved draft but disables resume without authorization', () => {
    const html = renderToStaticMarkup(
      <UploadBubble
        draft={fixtureDraft}
        stage={null}
        publishing={false}
        canResume={false}
        canDiscard={false}
        onResume={() => undefined}
        onDiscard={() => {}}
      />,
    )

    expect(html).toContain('Log in to resume')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toContain('Discard')
  })
})
