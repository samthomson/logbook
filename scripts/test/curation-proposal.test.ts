import assert from 'node:assert/strict'
import test from 'node:test'
import { deterministicProposal, proposeCuration, validateModelProposal } from '../curation-proposal.ts'

const a = 'a'.repeat(64)
const b = 'b'.repeat(64)
const nodes = [{ id: b, sectionId: 'one', createdAt: 2 }, { id: a, sectionId: 'one', createdAt: 1 }]

test('AI curation is a validated review-only proposal', async () => {
  const result = await proposeCuration(nodes, async () => JSON.stringify({ sections: [{ id: 'one', order: [b, a] }] }))
  assert.deepEqual(result, { source: 'ai', reviewRequired: true, sections: [{ id: 'one', order: [b, a] }] })
})

test('unknown or duplicate IDs are rejected strictly', () => {
  assert.throws(() => validateModelProposal({ sections: [{ id: 'one', order: ['c'.repeat(64)] }] }, nodes), /unknown/)
  assert.throws(() => validateModelProposal({ sections: [{ id: 'one', order: [a, a] }] }, nodes), /duplicate/)
  assert.throws(() => validateModelProposal({ sections: [{ id: 'unknown', order: [] }] }, nodes), /Invalid or duplicate/)
  assert.throws(() => validateModelProposal({ sections: [{ id: 'one', order: [] }, { id: 'one', order: [] }] }, nodes), /Invalid or duplicate/)
})

test('configuration, network, and invalid output failures use deterministic manual ordering', async () => {
  const absent = await proposeCuration(nodes)
  assert.equal(absent.source, 'deterministic')
  assert.deepEqual(absent.sections[0].order, [a, b])
  const failed = await proposeCuration(nodes, async () => { throw new Error('offline') })
  assert.equal(failed.source, 'deterministic')
  assert.match(failed.warning!, /manual review/)
})

test('all proposal paths reject malformed and duplicate input IDs', async () => {
  const duplicate = [nodes[0], { ...nodes[0], sectionId: 'two' }]
  assert.throws(() => deterministicProposal(duplicate), /invalid or duplicate/)
  await assert.rejects(() => proposeCuration(duplicate), /invalid or duplicate/)
  await assert.rejects(
    () => proposeCuration([{ id: 'not-an-event-id', sectionId: 'one', createdAt: 1 }]),
    /invalid or duplicate/,
  )
})
