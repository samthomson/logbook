import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { downloadVerifiedBlob, type BlobFetchResponse } from '../stitch-download.ts'

const servers = ['https://one.example', 'https://two.example']
const bytes = Buffer.from('fixture-audio')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const url = `https://untrusted.example/${sha256}`

function response(body: Buffer, contentLength: string | null = String(body.length)): BlobFetchResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => name === 'content-length' ? contentLength : null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  }
}

test('downloadVerifiedBlob falls through a corrupt mirror before writing verified bytes', async () => {
  const calls: string[] = []
  let written: Buffer | undefined
  await downloadVerifiedBlob({
    url, destPath: '/not-written-on-disk', expectedSha256: sha256, servers,
    fetchImpl: async (candidate) => {
      calls.push(candidate)
      return candidate.startsWith(servers[0]) ? response(Buffer.from('corrupt')) : response(bytes)
    },
    writeFile: (_path, output) => { written = output },
  })
  assert.equal(calls.length, 2)
  assert.deepEqual(written, bytes)
})

test('downloadVerifiedBlob never reads an oversized declared response or writes a hash mismatch', async () => {
  let read = false
  let writes = 0
  await assert.rejects(downloadVerifiedBlob({
    url, destPath: '/not-written-on-disk', expectedSha256: sha256, servers: [servers[0]], maxBytes: 8,
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: () => '9' },
      arrayBuffer: async () => { read = true; return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    }),
    writeFile: () => { writes++ },
  }), /exceeds 8 byte limit/)
  assert.equal(read, false)
  assert.equal(writes, 0)

  await assert.rejects(downloadVerifiedBlob({
    url, destPath: '/not-written-on-disk', expectedSha256: sha256, servers: [servers[0]],
    fetchImpl: async () => response(Buffer.from('wrong')),
    writeFile: () => { writes++ },
  }), /sha256 mismatch/)
  assert.equal(writes, 0)
})

test('downloadVerifiedBlob enforces actual size when the server omits content-length', async () => {
  let writes = 0
  await assert.rejects(downloadVerifiedBlob({
    url, destPath: '/not-written-on-disk', expectedSha256: sha256, servers: [servers[0]], maxBytes: 8,
    fetchImpl: async () => response(Buffer.from('ninebytes!'), null),
    writeFile: () => { writes++ },
  }), /exceeds 8 byte limit/)
  assert.equal(writes, 0)
})
