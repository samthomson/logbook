import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertHasAudioStream,
  loudnorm,
  MIN_FFMPEG_MAJOR,
  parseFfmpegMajor,
  parseLoudnormMeasurement,
  SilentClipError,
  stitchAudioSections,
} from '../stitch-media.ts'

test('ffmpeg version detection rejects builds whose silenceremove would empty the episode', () => {
  assert.equal(
    parseFfmpegMajor('ffmpeg version 7.1.5-0+deb13u1 Copyright (c) 2000-2026'),
    7,
  )
  assert.equal(parseFfmpegMajor('ffmpeg version 5.1.9-0+deb12u1 Copyright (c)'), 5)
  assert.equal(parseFfmpegMajor('ffmpeg version 8.0.1 Copyright (c) 2000-2025'), 8)
  // Source builds report a leading n, as in `ffmpeg version n6.0`.
  assert.equal(parseFfmpegMajor('ffmpeg version n6.0 Copyright (c)'), 6)
  assert.equal(parseFfmpegMajor('some other tool version 1.2'), null)

  // The boundary this guard exists to enforce, verified against real output.
  assert.ok(parseFfmpegMajor('ffmpeg version 5.1.9-0+deb12u1 Copyright')! < MIN_FFMPEG_MAJOR)
  assert.ok(parseFfmpegMajor('ffmpeg version 7.1.5-0+deb13u1 Copyright')! >= MIN_FFMPEG_MAJOR)
})

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

function measureIntegrated(path: string): number {
  const result = spawnSync(
    'ffmpeg',
    ['-i', path, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `loudness measure failed:\n${result.stderr}`)
  const inputI = Number(parseLoudnormMeasurement(result.stderr ?? '').input_i)
  assert.ok(Number.isFinite(inputI), `expected a finite integrated loudness, got ${inputI}`)
  return inputI
}

test('two-pass loudnorm brings a quiet clip and a loud clip to the same -16 LUFS target', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'logbook-loudnorm-'))
  try {
    const quiet = join(fixtureDir, 'quiet.wav')
    const loud = join(fixtureDir, 'loud.wav')
    run('ffmpeg', [
      '-y', '-f', 'lavfi',
      '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-af', 'volume=-20dB', quiet,
    ])
    run('ffmpeg', [
      '-y', '-f', 'lavfi',
      '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
      '-af', 'volume=-6dB', loud,
    ])

    const quietI = measureIntegrated(quiet)
    const loudI = measureIntegrated(loud)
    assert.ok(loudI - quietI > 10, `fixtures must differ in level: quiet ${quietI} loud ${loudI}`)

    const quietNorm = loudnorm(quiet, fixtureDir, 'quiet')
    const loudNorm = loudnorm(loud, fixtureDir, 'loud')
    const quietOut = measureIntegrated(quietNorm)
    const loudOut = measureIntegrated(loudNorm)

    assert.ok(Math.abs(quietOut - (-16)) < 1.5, `quiet clip landed at ${quietOut} LUFS`)
    assert.ok(Math.abs(loudOut - (-16)) < 1.5, `loud clip landed at ${loudOut} LUFS`)
    assert.ok(Math.abs(quietOut - loudOut) < 1.5, `clips still differ: ${quietOut} vs ${loudOut}`)
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})

test('loudnorm refuses a clip whose integrated loudness is -inf', () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'logbook-silent-clip-'))
  try {
    const silent = join(fixtureDir, 'silent.wav')
    run('ffmpeg', [
      '-y', '-f', 'lavfi',
      '-i', 'anullsrc=r=48000:cl=mono:d=1',
      silent,
    ])
    assert.throws(() => loudnorm(silent, fixtureDir, 'silent'), SilentClipError)
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
