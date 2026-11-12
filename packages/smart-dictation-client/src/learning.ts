import { extractLearningCandidates, mergeCandidate, type GlossaryEntry, type LearningCandidate } from '@smart-dictation/core'

export interface DraftStateLike {
  readonly draft: string
  readonly draftRev: number
  readonly phase: string
}

export interface DictationRecord {
  readonly raw: string
  readonly clean: string
  readonly draftRev?: number
  readonly sessionId?: string
}

export interface LearningCardSnapshot {
  readonly candidates: readonly LearningCandidate[]
  readonly status: 'open' | 'saving' | 'error'
  readonly error?: string
}

export interface LearningGlossary {
  readonly entries: readonly GlossaryEntry[]
  replaceEntries(entries: readonly GlossaryEntry[]): Promise<unknown>
  /** Re-reads the Host and applies a delta; prevents lost concurrent edits. */
  updateEntries?(mutator: (entries: readonly GlossaryEntry[]) => readonly GlossaryEntry[]): Promise<unknown>
}

export interface LearningControllerOptions {
  glossary: LearningGlossary
  enabled: () => boolean
  now?: () => string
}

/** Watches exactly one dictation until the next send, then asks before learning. */
export class LearningController {
  private readonly glossary: LearningGlossary
  private readonly enabled: () => boolean
  private readonly now: () => string
  private record: DictationRecord | undefined
  private lastState: DraftStateLike | undefined
  private card: LearningCardSnapshot | undefined
  private readonly listeners = new Set<() => void>()

  constructor(options: LearningControllerOptions) {
    this.glossary = options.glossary
    this.enabled = options.enabled
    this.now = options.now ?? (() => new Date().toISOString())
  }

  get current(): LearningCardSnapshot | undefined {
    return this.card
  }

  recordDictation(record: DictationRecord): void {
    this.record = record
    this.set(undefined)
  }

  observe(state: DraftStateLike): void {
    const previous = this.lastState
    this.lastState = state
    if (previous === undefined || previous.phase !== 'plain' || state.phase !== 'sending') return
    const record = this.record
    this.record = undefined
    if (record === undefined || !this.enabled()) return
    // The editor clears the draft during sending; the last plain snapshot is the message.
    const final = previous.draft
    if (final === record.clean) return
    const candidates = extractLearningCandidates({
      clean: record.clean,
      final,
      existing: this.glossary.entries
    })
    if (candidates.length === 0) return
    this.set({ candidates, status: 'open' })
  }

  async accept(): Promise<void> {
    const card = this.card
    if (card === undefined || card.status === 'saving') return
    this.set({ ...card, status: 'saving' })
    try {
      const apply = (source: readonly GlossaryEntry[]): GlossaryEntry[] => {
        let entries = [...source]
        for (const candidate of card.candidates) {
          entries = mergeCandidate(entries, candidate, this.now())
        }
        return entries
      }
      if (this.glossary.updateEntries) await this.glossary.updateEntries(apply)
      else await this.glossary.replaceEntries(apply(this.glossary.entries))
      this.set(undefined)
    } catch (error) {
      this.set({
        ...card,
        status: 'error',
        error: error instanceof Error ? error.message : 'Не удалось сохранить термин.'
      })
    }
  }

  reject(): void {
    this.set(undefined)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(card: LearningCardSnapshot | undefined): void {
    this.card = card
    for (const listener of this.listeners) listener()
  }
}
