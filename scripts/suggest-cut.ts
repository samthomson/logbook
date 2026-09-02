/**
 * Build a review-only segment selection/order proposal from a JSON node file.
 *
 * This command has no signer, relay publish, or manifest-write path. A producer
 * must review and apply the result explicitly. Missing AI configuration, network
 * errors, and invalid model output fall back to deterministic chronological order.
 *
 * Usage: npm run suggest-cut -- /path/to/nodes.json
 */
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { proposeCuration, type CurationNode, type ProposalModel } from './curation-proposal.ts'

const inputPath = process.argv[2]
if (!inputPath) {
  console.error('Usage: suggest-cut.ts <nodes.json>')
  process.exit(2)
}

function parseNodes(value: unknown): CurationNode[] {
  if (!Array.isArray(value)) throw new Error('Node input must be a JSON array')
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Node ${index} must be an object`)
    const node = raw as Partial<CurationNode>
    if (typeof node.id !== 'string' || !/^[0-9a-f]{64}$/.test(node.id)) throw new Error(`Node ${index} has an invalid event id`)
    if (typeof node.sectionId !== 'string' || !node.sectionId.trim()) throw new Error(`Node ${index} has an invalid section id`)
    if (!Number.isSafeInteger(node.createdAt) || Number(node.createdAt) < 0) throw new Error(`Node ${index} has an invalid timestamp`)
    return {
      id: node.id,
      sectionId: node.sectionId,
      createdAt: Number(node.createdAt),
      respondingTo: typeof node.respondingTo === 'string' ? node.respondingTo : null,
      transcript: typeof node.transcript === 'string' ? node.transcript.slice(0, 4_000) : undefined,
      duration: typeof node.duration === 'number' && Number.isFinite(node.duration) ? node.duration : undefined,
      validatedContributor: node.validatedContributor === true,
    }
  })
}

function anthropicModel(): ProposalModel | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const modelName = process.env.LOGBOOK_CURATION_MODEL?.trim()
  if (!apiKey || !modelName) return undefined
  const client = new Anthropic({ apiKey })
  return async (input) => {
    const response = await client.messages.create({
      model: modelName,
      max_tokens: 2_048,
      messages: [{ role: 'user', content: input }],
    })
    const text = response.content.find((block): block is { type: 'text'; text: string } => block.type === 'text')
    if (!text) throw new Error('AI returned no text proposal')
    return text.text
  }
}

try {
  const nodes = parseNodes(JSON.parse(readFileSync(inputPath, 'utf8')))
  const proposal = await proposeCuration(nodes, anthropicModel())
  process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`)
} catch (error) {
  // Input failures are operator-actionable, but never print raw input or provider details.
  console.error(error instanceof Error ? error.message : 'Unable to build curation proposal')
  process.exit(1)
}
