export interface DecodedWav {
  sampleRate: 16000
  samples: Float32Array
}

const RIFF = 'RIFF'
const WAVE = 'WAVE'

function ascii(view: DataView, offset: number, length: number): string {
  let value = ''
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(view.getUint8(offset + index))
  }
  return value
}

/**
 * Decode the canonical dictation WAV: 16 kHz, mono, PCM16, little-endian.
 * Rejecting everything else keeps the model input contract explicit.
 */
export function decodeWav(input: Uint8Array): DecodedWav {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  if (view.byteLength < 12 || ascii(view, 0, 4) !== RIFF || ascii(view, 8, 4) !== WAVE) {
    throw new Error('not a RIFF/WAVE file')
  }

  let format: { format: number; channels: number; sampleRate: number; bits: number } | undefined
  let data: Uint8Array | undefined
  let offset = 12

  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + size
    if (end > view.byteLength) throw new Error(`truncated ${id} chunk`)

    if (id === 'fmt ') {
      if (size < 16) throw new Error('short fmt chunk')
      format = {
        format: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bits: view.getUint16(start + 14, true)
      }
    } else if (id === 'data') {
      if (size % 2 !== 0) throw new Error('odd data chunk size')
      data = new Uint8Array(input.buffer, input.byteOffset + start, size)
    }

    offset = end + (size % 2)
  }

  if (!format) throw new Error('missing fmt chunk')
  if (!data) throw new Error('missing data chunk')
  if (format.format !== 1) throw new Error('only PCM WAV is supported')
  if (format.channels !== 1) throw new Error('only mono WAV is supported')
  if (format.sampleRate !== 16000) throw new Error('only 16 kHz WAV is supported')
  if (format.bits !== 16) throw new Error('only PCM16 WAV is supported')

  const samples = new Float32Array(data.byteLength / 2)
  const samplesView = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = samplesView.getInt16(index * 2, true) / 32768
  }
  return { sampleRate: 16000, samples }
}
