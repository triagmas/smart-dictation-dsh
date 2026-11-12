import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GigaAmRecognizer, type OrtModuleLike } from '../src/recognizer'

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

class FakeTensor {
  constructor(readonly type: string, readonly data: Float32Array | BigInt64Array, readonly dims: number[]) {}
}

function fakeOrt() {
  const preRun = vi.fn(async (feeds: Record<string, unknown>) => {
    void feeds
    return {
      features: new FakeTensor('float32', new Float32Array(128), [1, 64, 2]),
      features_lens: new FakeTensor('int64', BigInt64Array.from([2n]), [1])
    }
  })
  const acousticRun = vi.fn(async (feeds: Record<string, unknown>) => {
    void feeds
    const logits = new Float32Array(2 * 4)
    logits[1] = 1 // ▁
    logits[4 + 2] = 1 // п
    return { log_probs: new FakeTensor('float32', logits, [1, 2, 4]) }
  })
  const releasePre = vi.fn(async () => undefined)
  const releaseAcoustic = vi.fn(async () => undefined)
  const create = vi.fn(async (path: string, options: unknown) => {
    void options
    return path.includes('pre') 
      ? { run: preRun, release: releasePre }
      : { run: acousticRun, release: releaseAcoustic }
  })
  const ort: OrtModuleLike = {
    Tensor: FakeTensor as never,
    InferenceSession: { create: create as never }
  }
  return { ort, create, preRun, acousticRun, releasePre, releaseAcoustic }
}

let root: string | undefined
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function paths() {
  root = await mkdtemp(join(tmpdir(), 'smart-dictation-recognizer-'))
  const vocab = join(root, 'vocab.txt')
  await writeFile(vocab, '<unk> 0\n▁ 1\nп 2\n<blk> 3\n')
  return {
    preprocessor: join(root, 'pre.onnx'),
    acoustic: join(root, 'acoustic.onnx'),
    vocab
  }
}

describe('GigaAmRecognizer', () => {
  it('creates both sessions with four threads and decodes through core', async () => {
    const fake = fakeOrt()
    const files = await paths()
    const recognizer = await GigaAmRecognizer.create(files, { threads: 4, ort: fake.ort })

    const text = await recognizer.transcribe(pcm16([1, 2, 3]))

    expect(text).toBe('п')
    expect(fake.create).toHaveBeenCalledTimes(2)
    expect(fake.create.mock.calls[0]![1]).toMatchObject({ intraOpNumThreads: 4, interOpNumThreads: 1 })
    expect(fake.create.mock.calls[1]![1]).toMatchObject({ intraOpNumThreads: 4, interOpNumThreads: 1 })
    expect(fake.preRun).toHaveBeenCalledWith(expect.objectContaining({
      waveforms: expect.objectContaining({ dims: [1, 3] }),
      waveforms_lens: expect.objectContaining({ data: BigInt64Array.from([3n]) })
    }))
    expect(fake.acousticRun).toHaveBeenCalledWith(expect.objectContaining({
      features: expect.anything(),
      feature_lengths: expect.anything()
    }))

    await recognizer.close()
    expect(fake.releasePre).toHaveBeenCalledOnce()
    expect(fake.releaseAcoustic).toHaveBeenCalledOnce()
  })

  it('rejects empty audio before running inference', async () => {
    const fake = fakeOrt()
    const files = await paths()
    const recognizer = await GigaAmRecognizer.create(files, { ort: fake.ort })
    await expect(recognizer.transcribe(pcm16([]))).rejects.toThrow(/empty audio/i)
    expect(fake.preRun).not.toHaveBeenCalled()
  })

  it('rejects audio longer than two minutes', async () => {
    const fake = fakeOrt()
    const files = await paths()
    const recognizer = await GigaAmRecognizer.create(files, { ort: fake.ort })
    await expect(recognizer.transcribe(pcm16(new Array(16_000 * 120 + 1).fill(0)))).rejects.toThrow(/too long/i)
    expect(fake.preRun).not.toHaveBeenCalled()
  })

  it('rejects after close', async () => {
    const fake = fakeOrt()
    const files = await paths()
    const recognizer = await GigaAmRecognizer.create(files, { ort: fake.ort })
    await recognizer.close()
    await expect(recognizer.transcribe(pcm16([1]))).rejects.toThrow(/closed/i)
  })

  it('checks the abort signal around inference', async () => {
    const fake = fakeOrt()
    const files = await paths()
    const recognizer = await GigaAmRecognizer.create(files, { ort: fake.ort })
    const controller = new AbortController()
    controller.abort()
    await expect(recognizer.transcribe(pcm16([1]), controller.signal)).rejects.toThrow(/abort/i)
    expect(fake.preRun).not.toHaveBeenCalled()
  })
})
