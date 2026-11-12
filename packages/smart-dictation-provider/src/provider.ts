import type {
  SpeechInput,
  SpeechPreparation,
  SpeechPreparationOptions,
  SpeechPreparationState,
  SpeechProvider,
  SpeechProviderId,
  SpeechProviderInfo,
  Transcript
} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { ModelSnapshot } from './model-manager'
import { GigaAmRecognizer } from './recognizer'
import type { GigaAmPaths, GigaAmRecognizerOptions } from './recognizer'
import { decodeWav } from './wav'

const MAX_AUDIO_SECONDS = 120
const MAX_AUDIO_SAMPLES = MAX_AUDIO_SECONDS * 16000

export interface ProviderRecognizer {
  transcribe(wav: Uint8Array, signal?: AbortSignal): Promise<string>
  close(): Promise<void>
}

export type CreateRecognizer = (
  paths: GigaAmPaths,
  options: { threads: number }
) => Promise<ProviderRecognizer>

export interface ProviderModelSource {
  snapshot(): ModelSnapshot
  subscribe(listener: (snapshot: ModelSnapshot) => void): () => void
  prepare(options?: { downloadSource?: string }): Promise<void>
  cancel(): Promise<void>
  pathOf(filename: string): string
  sources(): string[]
}

export interface GigaAmProviderOptions {
  model: ProviderModelSource
  preprocessorPath: string
  threads?: number
  createRecognizer?: CreateRecognizer
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

/**
 * Host-local GigaAM provider. Preparation is owned by the model manager;
 * transcription is serialized so one ORT session never runs two jobs at once.
 */
export class GigaAmProvider implements SpeechProvider {
  readonly info: SpeechProviderInfo
  readonly preparation: SpeechPreparation

  private readonly model: ProviderModelSource
  private readonly preprocessorPath: string
  private readonly threads: number
  private readonly createRecognizer: CreateRecognizer
  private recognizer: ProviderRecognizer | undefined
  private recognizerPromise: Promise<ProviderRecognizer> | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private preparing = false
  private prepareStartedAt = 0
  private phase: ModelSnapshot['state'] = 'unprepared'
  private phaseStartedAt = Date.now()

  constructor(options: GigaAmProviderOptions) {
    this.model = options.model
    this.preprocessorPath = options.preprocessorPath
    this.threads = options.threads ?? 4
    this.createRecognizer = options.createRecognizer ?? (async (paths, settings) =>
      GigaAmRecognizer.create(paths, { threads: settings.threads }))

    this.info = {
      id: 'gigaam-local' as SpeechProviderId,
      name: 'GigaAM v3 E2E CTC (INT8, local)',
      location: 'host-local',
      languages: ['ru', 'auto'],
      downloadSources: [...this.model.sources()],
      setupEstimate: {
        recommendedDiskBytes: 500 * 1024 * 1024,
        expectedMemoryBytes: 700 * 1024 * 1024,
        minimumMinutes: 1,
        maximumMinutes: 10
      }
    }

    this.preparation = {
      snapshot: () => this.preparationSnapshot(),
      subscribe: (listener) => this.model.subscribe(() => listener()),
      prepare: (options?: SpeechPreparationOptions) => { this.startPreparation(options) },
      cancel: async () => {
        await this.model.cancel()
        this.preparing = false
      }
    }
  }

  transcribe(input: SpeechInput, signal: AbortSignal): Promise<Transcript> {
    const job = this.tail.then(
      async () => await this.perform(input, signal),
      async () => await this.perform(input, signal)
    )
    this.tail = job.then(() => undefined, () => undefined)
    return job
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const pending = this.recognizerPromise
    if (pending) await pending.catch(() => undefined)
    if (this.recognizer) await this.recognizer.close()
    this.recognizer = undefined
  }

  private startPreparation(options?: SpeechPreparationOptions): void {
    this.preparing = true
    this.prepareStartedAt = Date.now()
    const preparation = options?.downloadSource === undefined
      ? this.model.prepare()
      : this.model.prepare({ downloadSource: options.downloadSource })
    void preparation.catch(() => undefined).finally(() => {
      this.preparing = false
    })
  }

  private preparationSnapshot(): SpeechPreparationState {
    const model = this.model.snapshot()
    if (this.preparing && (model.state === 'unprepared' || model.state === 'ready')) {
      return { phase: 'checking', startedAt: this.prepareStartedAt, step: 'check' }
    }
    if (model.state !== this.phase) {
      this.phase = model.state
      this.phaseStartedAt = Date.now()
    }
    switch (model.state) {
      case 'checking':
        return { phase: 'checking', startedAt: this.phaseStartedAt, step: 'verify' }
      case 'downloading':
        return model.progress
          ? {
              phase: 'downloading',
              resource: model.progress.filename,
              completedBytes: model.progress.downloadedBytes,
              totalBytes: model.progress.totalBytes,
              step: 'model'
            }
          : { phase: 'downloading', resource: 'model', completedBytes: 0, step: 'model' }
      case 'loading':
        return { phase: 'loading', startedAt: this.phaseStartedAt, step: 'load' }
      case 'ready':
        return { phase: 'ready' }
      case 'failed':
        return { phase: 'failed', message: model.error?.message ?? 'model preparation failed' }
      case 'cancelled':
        return { phase: 'cancelled' }
      case 'unprepared':
      default:
        return { phase: 'unprepared' }
    }
  }

  private async perform(input: SpeechInput, signal: AbortSignal): Promise<Transcript> {
    if (this.closed) throw new Error('GigaAM provider is closed')
    signal.throwIfAborted()
    if (this.model.snapshot().state !== 'ready') {
      // A fresh Host process has no ONNX session yet. Load it on first use so
      // dictation after a restart does not require a separate manual step.
      this.preparing = true
      this.prepareStartedAt = Date.now()
      try {
        await this.model.prepare()
      } finally {
        this.preparing = false
      }
      if (this.model.snapshot().state !== 'ready') throw new Error('GigaAM model is not prepared')
    }
    if (!['ru', 'auto'].includes(input.language)) throw new Error(`unsupported language: ${input.language}`)

    const { samples } = decodeWav(input.audio)
    if (samples.length > MAX_AUDIO_SAMPLES) throw new Error('audio is longer than 120 seconds')
    signal.throwIfAborted()

    const recognizer = await this.ensureRecognizer()
    signal.throwIfAborted()
    const startedAt = performance.now()
    let text: string
    try {
      text = await recognizer.transcribe(input.audio, signal)
    } catch (error) {
      if (signal.aborted || isAbort(error)) throw error
      throw error
    }
    signal.throwIfAborted()
    const inferenceSeconds = (performance.now() - startedAt) / 1000
    return {
      text,
      audioSeconds: samples.length / 16000,
      inferenceSeconds
    }
  }

  private async ensureRecognizer(): Promise<ProviderRecognizer> {
    if (this.recognizer) return this.recognizer
    if (!this.recognizerPromise) {
      this.recognizerPromise = this.createRecognizer({
        preprocessor: this.preprocessorPath,
        acoustic: this.model.pathOf('v3_e2e_ctc.int8.onnx'),
        vocab: this.model.pathOf('v3_e2e_ctc_vocab.txt')
      }, { threads: this.threads }).then(
        (recognizer) => {
          this.recognizer = recognizer
          return recognizer
        },
        (error: unknown) => {
          // Do not poison the provider forever when ORT ran out of memory or
          // the model was mid-replacement; the next dictation may succeed.
          this.recognizerPromise = undefined
          throw error
        }
      )
    }
    return await this.recognizerPromise
  }
}
