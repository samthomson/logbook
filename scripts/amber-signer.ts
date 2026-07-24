import { readFile } from 'node:fs/promises'
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

async function readCompassBunker(): Promise<{ bunkerUri: string; clientKey: string }> {
  const directory = process.env.COMPASS_BUNKER_DIR ?? join(homedir(), '.config', 'compass-publish')
  const [configRaw, clientKey] = await Promise.all([
    readFile(join(directory, 'bunker.json'), 'utf8'),
    readFile(join(directory, 'client_key'), 'utf8'),
  ])
  const parsed = JSON.parse(configRaw) as { bunker_uri?: unknown }
  if (typeof parsed.bunker_uri !== 'string' || !parsed.bunker_uri.startsWith('bunker://')) {
    throw new Error('Compass bunker config is invalid')
  }
  const trimmedClientKey = clientKey.trim()
  if (!/^[a-f0-9]{64}$/.test(trimmedClientKey)) throw new Error('Compass bunker client key is invalid')
  return { bunkerUri: parsed.bunker_uri, clientKey: trimmedClientKey }
}

/** Ask the existing Compass Amber/NIP-46 bunker to sign one event without exposing its key. */
export async function signWithCompassAmber(unsigned: UnsignedNostrEvent): Promise<SignedNostrEvent> {
  const { bunkerUri, clientKey } = await readCompassBunker()
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

/**
 * Use the existing Compass Amber/NIP-46 session for every signing operation.
 * Construction is side-effect free; Amber is contacted only by signEvent().
 */
export function createCompassAmberSigner(): CompassSigner {
  return { signEvent: signWithCompassAmber }
}
