import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLoudnormMeasurement } from '../stitch-media.ts'

const FIXTURE = `
[Parsed_loudnorm_0 @ 0x13b5071e0]
{
	"input_i" : "-39.75",
	"input_tp" : "-36.05",
	"input_lra" : "0.00",
	"input_thresh" : "-49.75",
	"output_i" : "-16.05",
	"output_tp" : "-12.30",
	"output_lra" : "0.00",
	"output_thresh" : "-26.05",
	"normalization_type" : "linear",
	"target_offset" : "0.05"
}
`

test('parseLoudnormMeasurement reads the filter JSON off ffmpeg stderr', () => {
  assert.deepEqual(parseLoudnormMeasurement(FIXTURE), {
    input_i: '-39.75',
    input_tp: '-36.05',
    input_lra: '0.00',
    input_thresh: '-49.75',
    target_offset: '0.05',
  })
})

test('parseLoudnormMeasurement ignores an earlier brace in the log', () => {
  const measured = parseLoudnormMeasurement(`progress { speed: 1x }\n${FIXTURE}`)
  assert.equal(measured.input_i, '-39.75')
})

test('parseLoudnormMeasurement refuses stderr with no measurement object', () => {
  assert.throws(
    () => parseLoudnormMeasurement('ffmpeg version 8.0.1\nOutput #0, null'),
    /produced no JSON/,
  )
})
