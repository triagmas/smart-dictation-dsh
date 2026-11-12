import type { GlossaryDocument, GlossaryEntry } from '@smart-dictation/core'
import { ClientGlossaryStore, isGlossaryConflict, type CacheStorage } from './glossary-store'

export interface GlossarySnapshot {
  document: GlossaryDocument
  origin: 'host' | 'cache' | 'empty'
  writable: boolean
  error?: string
}

/** Holds the authoritative dictionary for the UI and processing pipeline. */
export class GlossaryController {
  private readonly store: ClientGlossaryStore
  private snapshot: GlossarySnapshot = {
    document: { version: 1, revision: 0, entries: [] },
    origin: 'empty',
    writable: false
  }
  private readonly listeners = new Set<() => void>()

  constructor(store: ClientGlossaryStore) {
    this.store = store
  }

  get current(): GlossarySnapshot {
    return this.snapshot
  }

  get entries(): readonly GlossaryEntry[] {
    return this.snapshot.document.entries
  }

  get source(): string {
    return this.snapshot.origin
  }

  async load(): Promise<GlossarySnapshot> {
    const result = await this.store.load()
    this.set({
      document: result.document,
      origin: result.origin,
      writable: result.writable,
      ...result.error === undefined ? {} : { error: result.error }
    })
    return this.snapshot
  }

  async save(document: GlossaryDocument, expectedRevision = this.snapshot.document.revision): Promise<GlossarySnapshot> {
    const result = await this.store.save(document, expectedRevision)
    this.set({ document: result.document, origin: 'host', writable: true })
    return this.snapshot
  }

  async replaceEntries(entries: readonly GlossaryEntry[]): Promise<GlossarySnapshot> {
    return await this.save({ ...this.snapshot.document, entries: [...entries] })
  }

  /**
   * Re-read the Host, apply an intentional delta and retry once on a conflict.
   * Used for removals and learning so concurrent tabs never lose entries.
   */
  async update(mutator: (entries: readonly GlossaryEntry[]) => readonly GlossaryEntry[]): Promise<GlossarySnapshot> {
    let last: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await this.store.load()
      if (!current.writable) throw new Error('Словарь доступен только для чтения.')
      const document: GlossaryDocument = {
        version: 1,
        revision: current.document.revision,
        entries: [...mutator(current.document.entries)]
      }
      try {
        return await this.save(document, current.document.revision)
      } catch (error) {
        last = error
        if (!isGlossaryConflict(error) || attempt === 1) throw error
      }
    }
    throw last
  }

  async updateEntries(mutator: (entries: readonly GlossaryEntry[]) => readonly GlossaryEntry[]): Promise<GlossarySnapshot> {
    return await this.update(mutator)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(snapshot: GlossarySnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

/** localStorage can be blocked (privacy mode); the Host remains authoritative. */
export function browserCacheStorage(): CacheStorage {
  try {
    const storage = globalThis.localStorage
    if (!storage) throw new Error('localStorage unavailable')
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key)
    }
  } catch {
    const memory = new Map<string, string>()
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value) },
      removeItem: (key) => { memory.delete(key) }
    }
  }
}
