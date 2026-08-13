/**
 * One-shot local bootstrap: fake newsletter + whitelist events.
 * Usage: npm run seed -- <issueNumber>
 */

import { spawnSync } from 'node:child_process'

const issue = process.argv[2] ?? '1'
const run = (script: string, args: string[] = []) => {
  const result = spawnSync('npx', ['tsx', script, ...args], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('seed-newsletter.mts', [issue])
run('seed-whitelist.mts')
