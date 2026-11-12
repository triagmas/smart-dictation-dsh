import { describe, expect, it, vi } from 'vitest'
import { GigaAmProvider, type ProviderModelSource } from '../src/provider'
import type { ModelSnapshot } from '../src/model-manager'

function pcm16(samples: number[]): Uint8Array {
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
  return new Uint8Array(Buffer.concat([header, data]))
}

function manager(overrides: Partial<ProviderModelSource> = {}): ProviderModelSource {
  let snapshot: ModelSnapshot = { state: 'ready' }
  return {
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
    prepare: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    pathOf: (filename) => `/models/${filename}`,
    sources: () => ['https://huggingface.co', 'https://hf-mirror.com'],
    ...overrides
  }
}

function provider(source = manager(), text = 'привет') {
  const recognizer = {
    transcribe: vi.fn(async () => text),
    close: vi.fn(async () => undefined)
  }
  const createRecognizer = vi.fn(async () => recognizer)
  const subject = new GigaAmProvider({
    model: source,
    preprocessorPath: '/assets/gigaam_v3.onnx',
    createRecognizer
  })
  return { subject, recognizer, createRecognizer }
}

describe('GigaAmProvider', () => {
  it('exposes host-local Russian metadata and sources', () => {
    const { subject } = provider()
    expect(subject.info.id).toBe('gigaam-local')
    expect(subject.info.languages).toEqual(expect.arrayContaining(['ru', 'auto']))
    expect(subject.info.location).toBe('host-local')
    expect(subject.info.setupEstimate?.recommendedDiskBytes).toBeGreaterThan(0)
    expect(subject.info.downloadSources).toEqual(['https://huggingface.co', 'https://hf-mirror.com'])
  })

  it('transcribes and measures audio and inference', async () => {
    const { subject, recognizer } = provider()
    const result = await subject.transcribe({ audio: pcm16([1, 2, 3]), language: 'ru' }, new AbortController().signal)
    expect(result.text).toBe('привет')
    expect(result.audioSeconds).toBeCloseTo(3 / 16000)
    expect(result.inferenceSeconds).toBeGreaterThanOrEqual(0)
    expect(recognizer.transcribe).toHaveBeenCalledOnce()
  })

  it('rejects audio longer than 120 seconds before inference', async () => {
    const { subject, recognizer } = provider()
    const tooLong = pcm16(new Array(120 * 16000 + 1).fill(0))
    await expect(subject.transcribe({ audio: tooLong, language: 'ru' }, new AbortController().signal))
      .rejects.toThrow(/120/u)
    expect(recognizer.transcribe).not.toHaveBeenCalled()
  })

  it('prepares the model automatically before the first transcription', async () => {
    let state: ModelSnapshot = { state: 'unprepared' }
    const prepare = vi.fn(async () => { state = { state: 'ready' } })
    const source = manager({ snapshot: () => state, prepare })
    const { subject, recognizer } = provider(source)
    const result = await subject.transcribe({ audio: pcm16([1]), language: 'ru' }, new AbortController().signal)
    expect(prepare).toHaveBeenCalledOnce()
    expect(result.text).toBe('привет')
    expect(recognizer.transcribe).toHaveBeenCalledOnce()
  })

  it('reports a preparation failure before transcription', async () => {
    const source = manager({
      snapshot: () => ({ state: 'unprepared' }),
      prepare: vi.fn(async () => { throw new Error('download failed') })
    })
    const { subject, recognizer } = provider(source)
    await expect(subject.transcribe({ audio: pcm16([1]), language: 'ru' }, new AbortController().signal))
      .rejects.toThrow(/download failed/u)
    expect(recognizer.transcribe).not.toHaveBeenCalled()
  })

  it('starts preparation without blocking and waits on cancel', async () => {
    let resolvePrepare: (() => void) | undefined
    const prepare = vi.fn(() => new Promise<void>((resolve) => { resolvePrepare = resolve }))
    const source = manager({ prepare })
    const { subject } = provider(source)
    expect(subject.preparation.prepare()).toBeUndefined()
    expect(prepare).toHaveBeenCalledOnce()
    expect(subject.preparation.snapshot().phase).toBe('checking')
    resolvePrepare?.()
    await subject.preparation.cancel()
  })

  it('closes the recognizer', async () => {
    const { subject, recognizer } = provider()
    await subject.transcribe({ audio: pcm16([1]), language: 'ru' }, new AbortController().signal)
    await subject.close()
    expect(recognizer.close).toHaveBeenCalledOnce()
  })
})

describe('recognizer failure recovery', () => {
  it('does not cache a rejected recognizer creation forever', async () => {
    const recognizer = {
      transcribe: vi.fn(async () => 'привет'),
      close: vi.fn(async () => undefined)
    }
    let calls = 0
    const subject = new GigaAmProvider({
      model: manager(),
      preprocessorPath: '/assets/gigaam_v3.onnx',
      createRecognizer: async () => {
        calls += 1
        if (calls === 1) throw new Error('ORT failed to load')
        return recognizer
      }
    })

    await expect(subject.transcribe({ audio: pcm16([1]), language: 'ru' }, new AbortController().signal))
      .rejects.toThrow(/ORT failed/u)
    await expect(subject.transcribe({ audio: pcm16([1]), language: 'ru' }, new AbortController().signal))
      .resolves.toMatchObject({ text: 'привет' })
    expect(calls).toBe(2)
  })
})
