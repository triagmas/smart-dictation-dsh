import { validateGlossaryDocument, type GlossaryDocument } from '@smart-dictation/core'

export const GLOSSARY_CACHE_KEY = 'dsh.smart-dictation.glossary.cache.v1'

export interface GlossaryTransport {
  read(): Promise<GlossaryDocument>
  replace(request: { document: GlossaryDocument; expectedRevision: number }): Promise<GlossaryDocument>
}

export interface CacheStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface GlossaryLoadResult {
  document: GlossaryDocument
  origin: 'host' | 'cache' | 'empty'
  writable: boolean
  migrated: boolean
  error?: string
}

export interface GlossarySaveResult {
  document: GlossaryDocument
  cacheWarning?: string
}

export interface ClientGlossaryStoreOptions {
  remote: GlossaryTransport
  storage: CacheStorage
  key?: string
  now?: () => number
}

const EMPTY: GlossaryDocument = { version: 1, revision: 0, entries: [] }

/** Host is authoritative; localStorage is only a read-only fallback cache. */
export class ClientGlossaryStore {
  private readonly remote: GlossaryTransport
  private readonly storage: CacheStorage
  private readonly key: string
  private readonly now: () => number
  private writable = false

  constructor(options: ClientGlossaryStoreOptions) {
    this.remote = options.remote
    this.storage = options.storage
    this.key = options.key ?? GLOSSARY_CACHE_KEY
    this.now = options.now ?? (() => Date.now())
  }

  async load(): Promise<GlossaryLoadResult> {
    const cached = this.readCache()
    let host: GlossaryDocument
    try {
      host = await this.remote.read()
      this.writable = true
    } catch (error) {
      this.writable = false
      return {
        document: cached ?? EMPTY,
        origin: cached ? 'cache' : 'empty',
        writable: false,
        migrated: false,
        error: error instanceof Error ? error.message : 'Host unavailable'
      }
    }

    if (host.origin === 'seed' && host.revision === 0 && cached && cached.entries.length > 0) {
      try {
        const migrated = await this.remote.replace({ document: cached, expectedRevision: 0 })
        this.persist(migrated)
        return { document: migrated, origin: 'host', writable: true, migrated: true }
      } catch (error) {
        if (!isGlossaryConflict(error)) {
          return {
            document: host, origin: 'host', writable: true, migrated: false,
            error: error instanceof Error ? error.message : 'Migration failed'
          }
        }
      }
    }

    this.persist(host)
    return { document: host, origin: 'host', writable: true, migrated: false }
  }

  async save(document: GlossaryDocument, expectedRevision: number): Promise<GlossarySaveResult> {
    if (!this.writable) throw new Error('Glossary is read-only: Host is unavailable')
    // A conflict must surface. Re-sending the caller's stale document under a
    // fresh revision would silently erase another tab's edits.
    const saved = await this.remote.replace({ document, expectedRevision })
    const warning = this.persist(saved)
    return warning === undefined ? { document: saved } : { document: saved, cacheWarning: warning }
  }

  private readCache(): GlossaryDocument | undefined {
    let raw: string | null
    try {
      raw = this.storage.getItem(this.key)
    } catch {
      return undefined
    }
    if (raw === null) return undefined
    try {
      const parsed = JSON.parse(raw) as { document?: unknown } | GlossaryDocument
      const candidate = 'document' in parsed ? parsed.document : parsed
      if (validateGlossaryDocument(candidate).length > 0) return undefined
      return candidate as GlossaryDocument
    } catch {
      return undefined
    }
  }

  private persist(document: GlossaryDocument): string | undefined {
    try {
      this.storage.setItem(this.key, JSON.stringify({ document, savedAt: this.now() }))
      return undefined
    } catch (error) {
      // A full cache must never turn a successful Host write into a failed one.
      return error instanceof Error ? error.message : 'Cache write failed'
    }
  }
}

export function isGlossaryConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    ('code' in error && error.code === 'conflict' || 'message' in error && /conflict|revision/iu.test(String(error.message)))
}
