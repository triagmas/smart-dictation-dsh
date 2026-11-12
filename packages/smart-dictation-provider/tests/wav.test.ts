import { describe, expect, it } from 'vitest'
import { decodeWav } from '../src/wav'

function pcm16(samples: number[]): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

describe('decodeWav', () => {
  it('decodes canonical 16 kHz mono PCM16', () => {
    const decoded = decodeWav(pcm16([0, 16384, -32768]))
    expect(decoded.sampleRate).toBe(16000)
    expect(decoded.samples).toBeInstanceOf(Float32Array)
    expect(decoded.samples).toHaveLength(3)
    expect(decoded.samples[0]).toBe(0)
    expect(decoded.samples[1]).toBeCloseTo(0.5, 5)
    expect(decoded.samples[2]).toBe(-1)
  })

  it('keeps silence at zero and the maximum sample near 1', () => {
    expect([...decodeWav(pcm16([0, 0])).samples]).toEqual([0, 0])
    expect(decodeWav(pcm16([32767])).samples[0]).toBeCloseTo(1, 3)
  })

  it.each([
    ['stereo', 2, 16000, 1, 16],
    ['8 kHz', 1, 8000, 1, 16],
    ['float', 1, 16000, 3, 32],
    ['no data', 1, 16000, 1, 16]
  ])('rejects %s', (_name, channels, sampleRate, format, bits) => {
    const wav = pcm16([1, 2])
    wav.writeUInt16LE(format, 20)
    wav.writeUInt16LE(channels, 22)
    wav.writeUInt32LE(sampleRate, 24)
    wav.writeUInt16LE(bits, 34)
    if (_name === 'no data') wav.write('junk', 36, 'ascii')
    expect(() => decodeWav(wav)).toThrow()
  })

  it('rejects an odd data chunk', () => {
    const wav = pcm16([1])
    const dataSize = 1
    wav.writeUInt32LE(dataSize, 40)
    const truncated = wav.subarray(0, 44 + 1)
    expect(() => decodeWav(truncated)).toThrow(/odd|data/i)
  })
})
