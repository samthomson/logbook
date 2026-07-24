import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertHasAudioStream, stitchAudioSections } from '../stitch-media.ts'

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stderr}`,
  )
  return result.stdout
}

test('native ffmpeg pipeline stitches generated clips into a valid MP3', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'logbook-stitch-integration-'))

  try {
    const clipDuration = 0.8
    const frequencies = [330, 440, 550, 660]
    const clips = frequencies.map((frequency, index) => {
      const path = join(fixtureDir, `clip-${index}.webm`)
      run('ffmpeg', [
        '-y',
        '-f', 'lavfi',
        '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${clipDuration}`,
        '-c:a', 'libopus',
        path,
      ])
      return path
    })

    const outputPath = join(fixtureDir, 'episode.mp3')
    stitchAudioSections(
      [
        [clips[0], clips[1]],
        [clips[2], clips[3]],
      ],
      outputPath,
      { workDir: join(fixtureDir, 'work'), crossfadeDuration: 0.3 },
    )

    const probe = JSON.parse(run('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_name,codec_type',
      '-of', 'json',
      outputPath,
    ])) as {
      streams: Array<{ codec_name: string; codec_type: string }>
      format: { duration: string }
    }

    assert.ok(
      probe.streams.some(
        (stream) => stream.codec_type === 'audio' && stream.codec_name === 'mp3',
      ),
      'expected an MP3 audio stream',
    )

    const duration = Number(probe.format.duration)
    const expectedDuration = (clipDuration * clips.length) - 0.3
    assert.ok(duration > 0, `expected nonzero duration, got ${duration}`)
    assert.ok(
      Math.abs(duration - expectedDuration) < 0.25,
      `expected duration near ${expectedDuration}s, got ${duration}s`,
    )
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})

test('ffprobe stream inspection accepts audio-bearing legacy WebM and rejects video-only media', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'logbook-stream-inspection-'))
  try {
    const audioWebm = join(fixtureDir, 'legacy.webm')
    run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', '-c:a', 'libopus', audioWebm])
    assert.doesNotThrow(() => assertHasAudioStream(audioWebm))

    const videoWebm = join(fixtureDir, 'video-only.webm')
    run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.1', '-an', '-c:v', 'libvpx-vp9', videoWebm])
    assert.throws(() => assertHasAudioStream(videoWebm), /no audio stream/i)
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})
