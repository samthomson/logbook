/**
 * transcribe-missing.ts — manual transcription backfill.
 *
 * Runs one transcribe-segments sweep over the last --hours of segments for
 * issues with a verified manifest, unpooled from the watch loop. The live
 * worker covers the common path every tick; this is the operator's repair
 * tool after a model/relay outage, and --retranscribe-all is the one-off
 * backfill after a model bump (run it with a wide --hours).
 *
 * Requirements: whisper-cli (whisper.cpp) in PATH, plus a model file
 * (default: LOGBOOK_WHISPER_MODEL, else ./models/ggml-small.en.bin).
 */

import { SimplePool } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { COMPASS_PUBKEY, KINDS, RELAYS, WHISPER_MODEL_PATH } from './config.ts'
import { createCompassAmberSigner } from './amber-signer.ts'
import { verifyNostrEvent } from './segment-security.ts'
import { fetchProducerPubkeys } from './producers.ts'
import {
  assertWhisperConfigured,
  makeTranscribeSweepDependencies,
  runTranscribeSweep,
} from './transcribe-segments.ts'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const hoursFlag = args.indexOf('--hours')
  const hours = hoursFlag !== -1 ? parseInt(args[hoursFlag + 1], 10) : 48
  const retranscribeAll = args.includes('--retranscribe-all')
  const modelFlag = args.indexOf('--model')
  const modelPath = modelFlag !== -1 ? args[modelFlag + 1] : WHISPER_MODEL_PATH

  assertWhisperConfigured(modelPath)

  const pool = new SimplePool()
  try {
    const signer = createCompassAmberSigner()
    const producers = await fetchProducerPubkeys(pool)
    const fetchManifests = async (): Promise<NostrEvent[]> => {
      const compass = COMPASS_PUBKEY.toLowerCase()
      const others = [...producers].filter((pubkey) => pubkey.toLowerCase() !== compass)
      const base = { kinds: [KINDS.MANIFEST], limit: 50 }
      const batches = await Promise.all([
        pool.querySync(RELAYS, { ...base, authors: [COMPASS_PUBKEY] }),
        others.length > 0
          ? pool.querySync(RELAYS, { ...base, authors: others })
          : Promise.resolve([]),
      ])
      return batches.flat() as NostrEvent[]
    }

    console.log(
      `[transcribe-missing] Backfilling segments from the last ${hours}h${retranscribeAll ? ', retranscribing all' : ''}…`,
    )
    const result = await runTranscribeSweep(
      makeTranscribeSweepDependencies(pool, signer, {
        modelPath,
        fetchManifests,
        expectedPubkey: producers,
        verify: (event) => verifyNostrEvent(event as NostrEvent),
        since: Math.floor(Date.now() / 1000) - hours * 3600,
      }),
      // The operator invoked a backfill: drain the whole window in one run.
      { maxPerSweep: Number.MAX_SAFE_INTEGER, retranscribeAll },
    )
    console.log(
      `[transcribe-missing] Done: ${result.transcribed}/${result.missing} transcribed` +
      (result.skipped ? `, ${result.skipped} skipped` : ''),
    )
  } finally {
    pool.close(RELAYS)
  }
}

main().catch((err) => {
  console.error('[transcribe-missing] Fatal:', err)
  process.exit(1)
})
