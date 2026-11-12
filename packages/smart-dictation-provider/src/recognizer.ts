import { readFile } from 'node:fs/promises'
import { decodeCtc } from '@smart-dictation/core'
import { decodeWav } from './wav'

export interface OrtTensorLike {
  readonly data: Float32Array | BigInt64Array
  readonly dims: readonly number[]
}

export interface OrtSessionLike {
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>
  release?(): Promise<void>
}

export interface OrtModuleLike {
  Tensor: new (
    type: 'float32' | 'int64',
    data: Float32Array | BigInt64Array,
    dims: readonly number[]
  ) => OrtTensorLike
  InferenceSession: {
    create(path: string, options: Record<string, unknown>): Promise<OrtSessionLike>
  }
}

export interface GigaAmPaths {
  preprocessor: string
  acoustic: string
  vocab: string
}

export interface GigaAmRecognizerOptions {
  threads?: number
  ort?: OrtModuleLike
}

export const MAX_AUDIO_SECONDS = 120

function parseVocab(text: string): string[] {
  const vocab: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const match = /^(.*)\s+(\d+)$/u.exec(line)
    if (match) vocab[Number(match[2])] = match[1]!
  }
  if (vocab.length === 0 || vocab.some((token) => token === undefined)) {
    throw new Error('invalid GigaAM vocab')
  }
  if (!vocab.includes('<blk>')) throw new Error('GigaAM vocab has no <blk> token')
  return vocab
}

async function loadOrt(): Promise<OrtModuleLike> {
  return await import('onnxruntime-node') as unknown as OrtModuleLike
}

/**
 * One GigaAM v3 E2E CTC recognizer. Sessions are created once and reused;
 * inference itself is not interruptible, so callers check the signal around it.
 */
export class GigaAmRecognizer {
  private closed = false

  private constructor(
    private readonly ort: OrtModuleLike,
    private readonly preprocessor: OrtSessionLike,
    private readonly acoustic: OrtSessionLike,
    private readonly vocab: readonly string[],
    private readonly blankId: number
  ) {}

  static async create(paths: GigaAmPaths, options: GigaAmRecognizerOptions = {}): Promise<GigaAmRecognizer> {
    const threads = options.threads ?? 4
    if (!Number.isInteger(threads) || threads < 1 || threads > 32) {
      throw new Error('threads must be an integer between 1 and 32')
    }
    const ort = options.ort ?? await loadOrt()
    const vocab = parseVocab(await readFile(paths.vocab, 'utf8'))
    const sessionOptions = { intraOpNumThreads: threads, interOpNumThreads: 1 }
    const [preprocessor, acoustic] = await Promise.all([
      ort.InferenceSession.create(paths.preprocessor, sessionOptions),
      ort.InferenceSession.create(paths.acoustic, sessionOptions)
    ])
    return new GigaAmRecognizer(
      ort,
      preprocessor,
      acoustic,
      vocab,
      vocab.indexOf('<blk>')
    )
  }

  async transcribe(wav: Uint8Array, signal?: AbortSignal): Promise<string> {
    if (this.closed) throw new Error('recognizer is closed')
    signal?.throwIfAborted()

    const { samples } = decodeWav(wav)
    if (samples.length === 0) throw new Error('empty audio')
    if (samples.length > MAX_AUDIO_SECONDS * 16_000) throw new Error('audio is too long')
    const waveforms = new this.ort.Tensor('float32', samples, [1, samples.length])
    const waveformsLens = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(samples.length)]), [1])
    const pre = await this.preprocessor.run({ waveforms, waveforms_lens: waveformsLens })
    signal?.throwIfAborted()

    const features = pre.features
    const featuresLens = pre.features_lens
    if (!features || !featuresLens) throw new Error('GigaAM preprocessor returned no features')

    const out = await this.acoustic.run({ features, feature_lengths: featuresLens })
    signal?.throwIfAborted()

    const logProbs = out.log_probs ?? Object.values(out)[0]
    if (!logProbs) throw new Error('GigaAM acoustic model returned no log_probs')
    if (!(logProbs.data instanceof Float32Array)) throw new Error('GigaAM log_probs must be float32')
    const [, timeSteps, vocabSize] = logProbs.dims
    if (timeSteps === undefined || vocabSize === undefined) throw new Error('GigaAM log_probs has invalid dims')

    return decodeCtc(logProbs.data, this.vocab, {
      blankId: this.blankId,
      timeSteps,
      vocabSize
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all([
      this.preprocessor.release?.(),
      this.acoustic.release?.()
    ])
  }
}
