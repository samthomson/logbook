import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { verifyNostrEvent } from './segment-security.ts'
import { COMPASS_PUBKEY } from './config.ts'

export interface UnsignedNostrEvent {
  kind: number
  created_at: number
  tags: string[][]
  content: string
}

export interface SignedNostrEvent extends UnsignedNostrEvent {
  id: string
  pubkey: string
  sig: string
}

/** Shared signer boundary for every Compass-authored release event. */
export interface CompassSigner {
  signEvent(unsigned: UnsignedNostrEvent): Promise<SignedNostrEvent>
}

export function validateCompassSignature(event: SignedNostrEvent, expectedPubkey = COMPASS_PUBKEY): SignedNostrEvent {
  if (event.pubkey !== expectedPubkey) throw new Error('Amber signed with an unexpected public key')
  if (!event.id || !event.sig || !verifyNostrEvent(event)) throw new Error('Amber returned an invalid signed event')
  return event
}

/**
 * Fail before the watcher starts polling rather than at the first event it needs
 * to sign, which could be days later.
 */
export async function assertCompassSignerConfigured(): Promise<void> {
  try {
    readCompassBunker()
  } catch (error) {
    throw new Error(
      'No Compass signer configured. Set COMPASS_BUNKER_URI and ' +
      `COMPASS_BUNKER_CLIENT_KEY. Cause: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

/** NIP-46 session from env — same path locally and in Dokploy. */
function readCompassBunker(): { bunkerUri: string; clientKey: string } {
  const bunkerUri = process.env.COMPASS_BUNKER_URI?.trim()
  const clientKey = process.env.COMPASS_BUNKER_CLIENT_KEY?.trim().toLowerCase()
  if (!bunkerUri) throw new Error('COMPASS_BUNKER_URI is required')
  if (!bunkerUri.startsWith('bunker://')) {
    throw new Error('COMPASS_BUNKER_URI must be a bunker:// URI')
  }
  if (!clientKey) throw new Error('COMPASS_BUNKER_CLIENT_KEY is required')
  if (!/^[0-9a-f]{64}$/.test(clientKey)) {
    throw new Error('COMPASS_BUNKER_CLIENT_KEY must be a 64-character hex key')
  }
  return { bunkerUri, clientKey }
}

/** Bunker dropped this RPC; the same sign is still required. */
export function isRetryableBunkerError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return /context canceled/i.test(text)
}

async function signOnce(unsigned: UnsignedNostrEvent): Promise<SignedNostrEvent> {
  const { bunkerUri, clientKey } = readCompassBunker()
  const nak = process.env.NAK_BIN ?? join(homedir(), '.local', 'bin', 'nak')
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(nak, ['event', '--connect-as', clientKey], {
      env: { ...process.env, NOSTR_SECRET_KEY: bunkerUri },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`Amber signing failed (${code ?? 'signal'}): ${stderr.replace(/bunker:\/\/\S+/g, 'bunker://[REDACTED]')}`))
    })
    child.stdin.end(JSON.stringify(unsigned))
  })
  return validateCompassSignature(JSON.parse(output) as SignedNostrEvent)
}

/** Ask the Compass NIP-46 bunker to sign one event without exposing its key. */
export async function signWithCompassAmber(unsigned: UnsignedNostrEvent): Promise<SignedNostrEvent> {
  let last: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await signOnce(unsigned)
    } catch (error) {
      last = error
      if (!isRetryableBunkerError(error) || attempt === 3) throw error
      console.warn(`[amber] bunker sign canceled, retrying (${attempt}/2)`)
    }
  }
  throw last
}

/**
 * Use the Compass NIP-46 session for every signing operation.
 * Construction is side-effect free; the bunker is contacted only by signEvent().
 */
export function createCompassAmberSigner(): CompassSigner {
  return { signEvent: signWithCompassAmber }
}
