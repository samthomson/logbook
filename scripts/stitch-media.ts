import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface StitchAudioOptions {
  workDir: string
  crossfadeDuration?: number
}

/**
 * The stitcher's trimSilence pass relies on ffmpeg 7's reworked silenceremove.
 * Under ffmpeg 5 and 6 the same filter discards every clip and the episode
 * encodes to an empty MP3 — a silent corruption that only surfaces once the
 * audio is published, so the version is checked before any work starts.
 */
export const MIN_FFMPEG_MAJOR = 7

export function parseFfmpegMajor(versionOutput: string): number | null {
  const match = versionOutput.match(/ffmpeg version n?(\d+)\./)
  return match ? Number(match[1]) : null
}

export function requireFfmpeg(): void {
  const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error('ffmpeg not found in PATH. Install it: apt install ffmpeg')
  }
  const major = parseFfmpegMajor(result.stdout ?? '')
  if (major === null) {
    throw new Error(
      `Could not determine ffmpeg version from:\n${(result.stdout ?? '').split('\n')[0]}`,
    )
  }
  if (major < MIN_FFMPEG_MAJOR) {
    throw new Error(
      `ffmpeg ${major} is too old: the stitcher requires ffmpeg ${MIN_FFMPEG_MAJOR} or newer, ` +
      'because older silenceremove discards whole clips and yields an empty episode.',
    )
  }
}

export function assertHasAudioStream(inputPath: string): void {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', inputPath],
    { encoding: 'utf8' },
  )
  if (result.error || result.status !== 0) {
    throw new Error(`ffprobe audio-stream inspection failed:\n${result.stderr ?? result.error?.message}`)
  }
  try {
    const probe = JSON.parse(result.stdout) as { streams?: Array<{ codec_type?: string }> }
    if (!probe.streams?.some((stream) => stream.codec_type === 'audio')) {
      throw new Error('Media has no audio stream')
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Media has no audio stream') throw error
    throw new Error('ffprobe audio-stream inspection returned invalid JSON')
  }
}

function ff(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-y', ...args], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error(`ffmpeg failed:\n${result.stderr ?? result.error?.message}`)
  }
}

/** Podcast target: EBU R128 / YouTube-style speech, -16 LUFS, true peak -1.5 dB. */
const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11'
/** Measure and apply on the same layout the stitcher concatenates. */
const STEREO_48K = 'aformat=sample_rates=48000:channel_layouts=stereo'

export interface LoudnormMeasurement {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

const MEASURED_FIELDS = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const

/**
 * loudnorm's JSON is on stderr after the filter log line. A first `{` in the
 * banner or progress dump is not that object — require `input_i`.
 */
export function parseLoudnormMeasurement(stderr: string): LoudnormMeasurement {
  const match = stderr.match(/\{\s*"input_i"\s*:\s*"[^"]+"[\s\S]*?\}/)
  if (!match) {
    throw new Error(`ffmpeg loudnorm measurement produced no JSON:\n${stderr}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch (cause) {
    throw new Error(`ffmpeg loudnorm measurement JSON is invalid:\n${match[0]}`, { cause })
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`ffmpeg loudnorm measurement JSON is invalid:\n${match[0]}`)
  }
  const record = parsed as Record<string, unknown>
  for (const field of MEASURED_FIELDS) {
    if (typeof record[field] !== 'string') {
      throw new Error(`ffmpeg loudnorm measurement is missing ${field}:\n${match[0]}`)
    }
  }
  return {
    input_i: record.input_i as string,
    input_tp: record.input_tp as string,
    input_lra: record.input_lra as string,
    input_thresh: record.input_thresh as string,
    target_offset: record.target_offset as string,
  }
}

/**
 * A recording that captured no signal measures an integrated loudness of -inf,
 * which loudnorm's second pass rejects. Normalising it is not an option either:
 * lifting silence to -16 LUFS would apply ~80 dB of gain to the noise floor.
 */
export class SilentClipError extends Error {
  constructor(readonly clip: string) {
    super(`Clip ${clip} carries no audio: its integrated loudness measures -inf.`)
    this.name = 'SilentClipError'
  }
}

/**
 * Two-pass EBU R128. A single loudnorm pass is dynamic and pumps on speech;
 * the apply pass needs the measured values from a full read of the clip.
 */
export function loudnorm(inputPath: string, outDir: string, stem?: string): string {
  const outPath = join(outDir, `${stem ?? basename(inputPath).replace(/\.[^.]+$/, '')}_norm.wav`)
  const pass1 = spawnSync(
    'ffmpeg',
    ['-i', inputPath, '-af', `${STEREO_48K},${LOUDNORM}:print_format=json`, '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  if (pass1.error || pass1.status !== 0) {
    throw new Error(`ffmpeg loudnorm measurement failed:\n${pass1.stderr ?? pass1.error?.message}`)
  }

  const measured = parseLoudnormMeasurement(pass1.stderr ?? '')
  if (!Number.isFinite(Number(measured.input_i))) {
    throw new SilentClipError(basename(inputPath))
  }
  const filter = `${STEREO_48K},${[
    LOUDNORM,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
  ].join(':')}`

  ff(['-i', inputPath, '-af', filter, outPath])
  return outPath
}

export function trimSilence(inputPath: string, outDir: string, stem?: string): string {
  const outPath = join(outDir, `${stem ?? basename(inputPath, '.wav')}_trim.wav`)
  ff([
    '-i', inputPath,
    '-af', 'silenceremove=start_periods=1:start_silence=0.5:stop_periods=1:stop_silence=0.5',
    outPath,
  ])
  return outPath
}

export function concatSection(clips: string[], outPath: string): void {
  if (clips.length === 0) throw new Error('Cannot concatenate an empty section')
  if (clips.length === 1) {
    ff(['-i', clips[0], '-c', 'copy', outPath])
    return
  }

  const inputs = clips.flatMap((clip) => ['-i', clip])
  const filterInputs = clips.map((_, index) => `[${index}:a]`).join('')
  ff([
    ...inputs,
    '-filter_complex', `${filterInputs}concat=n=${clips.length}:v=0:a=1[out]`,
    '-map', '[out]',
    outPath,
  ])
}

export function acrossfade(
  firstPath: string,
  secondPath: string,
  outPath: string,
  duration = 0.3,
): void {
  ff([
    '-i', firstPath,
    '-i', secondPath,
    '-filter_complex', `acrossfade=d=${duration}:c1=tri:c2=tri`,
    outPath,
  ])
}

export function encodeMp3(inputPath: string, outPath: string): void {
  ff(['-i', inputPath, '-codec:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', outPath])
}

export function stitchAudioSections(
  sections: string[][],
  outputPath: string,
  options: StitchAudioOptions,
): void {
  if (sections.length === 0 || sections.some((section) => section.length === 0)) {
    throw new Error('Stitch input must contain non-empty sections')
  }

  requireFfmpeg()
  mkdirSync(options.workDir, { recursive: true })

  const sectionWavs = sections.map((clips, sectionIndex) => {
    const trimmed = clips.map((clip, clipIndex) => {
      const stem = `section-${sectionIndex}-clip-${clipIndex}`
      return trimSilence(loudnorm(clip, options.workDir, stem), options.workDir, stem)
    })
    const sectionPath = join(options.workDir, `section-${sectionIndex}.wav`)
    concatSection(trimmed, sectionPath)
    return sectionPath
  })

  let stitchedPath = sectionWavs[0]
  for (let index = 1; index < sectionWavs.length; index++) {
    const fadedPath = join(options.workDir, `faded-${index}.wav`)
    acrossfade(
      stitchedPath,
      sectionWavs[index],
      fadedPath,
      options.crossfadeDuration ?? 0.3,
    )
    stitchedPath = fadedPath
  }

  encodeMp3(stitchedPath, outputPath)
}
