import assert from 'node:assert/strict'
import test from 'node:test'
import { madeTheCutReactionTags } from '../made-the-cut.ts'

test('made-the-cut reactions address the included segment author with a p tag', () => {
  assert.deepEqual(madeTheCutReactionTags('segment-id', 'author-pubkey'), [
    ['e', 'segment-id'],
    ['p', 'author-pubkey'],
    ['k', '4200'],
  ])
})
