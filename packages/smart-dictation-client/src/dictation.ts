import { processTranscript, type GlossaryEntry, type ProcessResult } from '@smart-dictation/core'
import { base64Wav } from './recorder'

export interface InsertionActions {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
}

export interface SpeechRequest {
  audioBase64: string
  language?: string
}

export type SpeechTranscriber = (
  request: SpeechRequest,
  signal?: AbortSignal
) => Promise<
  | { ok: true; value: { text: string } }
  | { ok: false; error: { message: string } }
>

export type DictationOutcome =
  | { status: 'inserted'; text: string; raw: string; changes: ProcessResult['changes']; replacements: number; dictionarySource: string }
  | { status: 'pending'; text: string; raw: string; changes: ProcessResult['changes']; replacements: number; dictionarySource: string }
  | { status: 'empty' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

export interface DictationControllerOptions {
  insert: InsertionActions
  transcribe: SpeechTranscriber
  glossary?: () => readonly GlossaryEntry[]
  glossarySource?: () => string
}

/** Keeps the insertion span and a conflicting transcript until the user decides. */
export class DictationController {
  private readonly insertActions: InsertionActions
  private readonly transcribeSpeech: SpeechTranscriber
  private readonly glossaryEntries: () => readonly GlossaryEntry[]
  private readonly source: () => string
  private span: unknown
  private hasSpan = false
  private pendingText = ''
  private pendingOutcome: Extract<DictationOutcome, { status: 'pending' }> | undefined
  private cancelled = false

  constructor(options: DictationControllerOptions) {
    this.insertActions = options.insert
    this.transcribeSpeech = options.transcribe
    this.glossaryEntries = options.glossary ?? (() => [])
    this.source = options.glossarySource ?? (() => 'empty')
  }

  get pending(): string {
    return this.pendingText
  }

  /** Draft revision captured by begin(); used to associate learning with one message. */
  get spanRevision(): number | undefined {
    if (typeof this.span !== 'object' || this.span === null) return undefined
    const revision = (this.span as { draftRev?: unknown }).draftRev
    return typeof revision === 'number' ? revision : undefined
  }

  begin(): void {
    this.cancelled = false
    this.span = this.insertActions.captureInsertion()
    this.hasSpan = true
  }

  cancel(): void {
    this.cancelled = true
    this.pendingText = ''
    this.pendingOutcome = undefined
    this.span = undefined
    this.hasSpan = false
  }

  async insert(wav: Uint8Array, signal?: AbortSignal): Promise<DictationOutcome> {
    if (this.cancelled) return { status: 'cancelled' }
    if (!this.hasSpan) this.begin()
    const result = await this.transcribeSpeech({ audioBase64: base64Wav(wav), language: 'ru' }, signal)
    if (this.cancelled) return { status: 'cancelled' }
    if (!result.ok) return { status: 'failed', message: result.error.message }
    const processed = processTranscript(result.value.text, this.glossaryEntries())
    const text = processed.clean.trim()
    const fingerprint = {
      raw: processed.raw,
      changes: processed.changes,
      replacements: processed.changes.filter((change) => change.kind === 'glossary').length,
      dictionarySource: this.source()
    }
    if (text === '') return { status: 'empty' }
    if (!this.insertActions.insertText(text, this.span)) {
      this.pendingText = text
      this.pendingOutcome = { status: 'pending', text, ...fingerprint }
      this.span = undefined
      this.hasSpan = false
      return this.pendingOutcome
    }
    this.span = undefined
    this.hasSpan = false
    return { status: 'inserted', text, ...fingerprint }
  }

  retry(): DictationOutcome | undefined {
    const pending = this.pendingOutcome
    if (pending === undefined) return undefined
    const span = this.insertActions.captureInsertion()
    if (!this.insertActions.insertText(pending.text, span)) return undefined
    this.pendingText = ''
    this.pendingOutcome = undefined
    this.span = undefined
    this.hasSpan = false
    return { ...pending, status: 'inserted' }
  }
}
