import { describe, expect, it } from 'vitest'
import { base64Wav, encodeWav, resampleTo16k } from '../src/recorder'

function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}
function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

describe('recorder PCM helpers', () => {
  it('encodes mono 16 kHz PCM16 WAV with exact lengths', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
    const wav = encodeWav(samples)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    expect(String.fromCharCode(...wav.subarray(12, 16))).toBe('fmt ')
    expect(u16(wav, 20)).toBe(1)
    expect(u16(wav, 22)).toBe(1)
    expect(u32(wav, 24)).toBe(16000)
    expect(u16(wav, 34)).toBe(16)
    expect(u32(wav, 40)).toBe(samples.length * 2)
    expect(wav.byteLength).toBe(44 + samples.length * 2)
    expect(new DataView(wav.buffer).getInt16(44, true)).toBe(0)
    expect(new DataView(wav.buffer).getInt16(46, true)).toBe(16384)
    expect(new DataView(wav.buffer).getInt16(48, true)).toBe(-16384)
  })

  it('resamples 48 kHz audio to 16 kHz preserving duration', () => {
    const input = new Float32Array(48_000)
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / 48_000)
    const output = resampleTo16k(input, 48_000)
    expect(Math.abs(output.length - 16_000)).toBeLessThanOrEqual(1)
    expect(Math.abs(output[8000]!)).toBeGreaterThan(0)
  })

  it('base64-encodes a WAV payload without data URLs', () => {
    const encoded = base64Wav(encodeWav(new Float32Array([0.1, 0.2])))
    expect(encoded.startsWith('UklGR')).toBe(true)
  })
})
