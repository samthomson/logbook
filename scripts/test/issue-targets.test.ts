import assert from 'node:assert/strict'
import test from 'node:test'
import { requiredChapterTargets } from '../issue-targets.ts'

test('requiredChapterTargets matches the PWA chapter projection for lead prose and named items', () => {
  const markdown = [
    '## Apps & Clients',
    'A lead paragraph that is itself narrated.',
    '### Amber Wallet',
    'Details.',
    '### ND Next',
    'Details.',
    '## Protocol',
    '### NIP-55',
    'Details.',
    '## Editorial',
    '',
  ].join('\n')

  assert.deepEqual(requiredChapterTargets(markdown, 32), [
    { id: 'sec-apps-clients-32', title: 'Apps & Clients' },
    { id: 'sec-apps-clients-amber-wallet-32', title: 'Amber Wallet' },
    { id: 'sec-apps-clients-nd-next-32', title: 'ND Next' },
    { id: 'sec-protocol-nip-55-32', title: 'NIP-55' },
    { id: 'sec-editorial-32', title: 'Editorial' },
  ])
})
