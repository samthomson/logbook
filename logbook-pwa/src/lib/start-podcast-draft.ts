import { COMPASS_PUBKEY, KINDS } from '../config'
import type { IssueManifest, ManifestContent, NostrEvent, NostrSigner } from '../types/nostr'
import { createAdminSaveController, type AdminSaveDependencies } from './admin-save'
import { buildRecordingTargets } from './admin-workspace'
import { issueAddress, parseIssue } from './compass'
import { isLogbookNewsletter } from './issue-index'
import { buildInitialManifest, fetchManifest, updateManifest } from './manifest'
import { assertExpectedSignerPubkey } from './signer-identity'
import { withSignerTimeout } from './signer-timeout'

export interface StartPodcastDraftParams {
  issueEvent: NostrEvent
  signer: NostrSigner
  expectedPubkey: string
  assertActive?: () => void
  save?: AdminSaveDependencies
}

function defaultSave(issueNumber: number, signer: NostrSigner): AdminSaveDependencies {
  return {
    fetchLatest: () => fetchManifest(issueNumber),
    publish: (next, previousEventId, previousCreatedAt, assert) => updateManifest(
      issueNumber,
      next,
      signer,
      undefined,
      previousEventId,
      previousCreatedAt,
      assert,
    ),
  }
}

/** Publish the first kind 34200 for a Compass newsletter. Fails if one already exists. */
export async function startPodcastDraft(params: StartPodcastDraftParams): Promise<IssueManifest> {
  const { issueEvent, signer, expectedPubkey, assertActive } = params
  if (issueEvent.kind !== KINDS.COMPASS_ISSUE) {
    throw new Error('Only a Compass newsletter can start a Logbook episode.')
  }
  if (issueEvent.pubkey.toLowerCase() !== COMPASS_PUBKEY) {
    throw new Error('Only a Compass newsletter can start a Logbook episode.')
  }
  if (!isLogbookNewsletter(issueEvent)) {
    throw new Error('This Compass issue is not a Logbook episode.')
  }

  const issue = parseIssue(issueEvent)
  if (issue.issueNumber <= 0) {
    throw new Error('This Compass issue has no issue number.')
  }
  const targets = buildRecordingTargets(issue)
  if (targets.length === 0) {
    throw new Error('This Compass issue has no sections to record against.')
  }

  assertActive?.()
  const pubkey = await withSignerTimeout(signer.getPublicKey(), 'Signer identity request')
  assertExpectedSignerPubkey(pubkey, expectedPubkey)

  const content: ManifestContent = buildInitialManifest(
    issue.issueNumber,
    issueAddress(issue),
    targets,
  )
  const controller = createAdminSaveController(params.save ?? defaultSave(issue.issueNumber, signer))
  return controller.save(null, content, assertActive)
}
