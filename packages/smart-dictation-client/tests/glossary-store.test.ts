import { describe, expect, it, vi } from 'vitest'
import type { GlossaryDocument, GlossaryEntry } from '@smart-dictation/core'
import { ClientGlossaryStore, GLOSSARY_CACHE_KEY, type GlossaryTransport } from '../src/glossary-store'

const entry: GlossaryEntry = {
  id: 'k8s', canonical: 'Kubernetes', variants: ['кубернетес'], source: 'manual',
  confidence: 1, seen: 0, createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z'
}
const empty: GlossaryDocument = { version: 1, revision: 0, entries: [] }
const filled: GlossaryDocument = { version: 1, revision: 1, entries: [entry] }

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  let fail = false
  return {
    data,
    failNextWrite() { fail = true },
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail) { fail = false; throw new DOMException('quota', 'QuotaExceededError') }
      data.set(key, value)
    },
    removeItem: (key: string) => { data.delete(key) }
  }
}
function remote(overrides: Partial<GlossaryTransport> = {}) {
  return {
    read: vi.fn(async () => empty),
    replace: vi.fn(async ({ document }: { document: GlossaryDocument; expectedRevision: number }) => document),
    ...overrides
  }
}

describe('ClientGlossaryStore', () => {
  it('loads the Host document and refreshes the cache', async () => {
    const cache = storage()
    const host = remote({ read: vi.fn(async () => filled) })
    const subject = new ClientGlossaryStore({ remote: host, storage: cache })
    await expect(subject.load()).resolves.toMatchObject({ document: filled, origin: 'host', writable: true })
    expect(JSON.parse(cache.data.get(GLOSSARY_CACHE_KEY)!).document).toEqual(filled)
  })

  it('returns an empty writable document for an empty Host and empty cache', async () => {
    const cache = storage()
    const subject = new ClientGlossaryStore({ remote: remote(), storage: cache })
    await expect(subject.load()).resolves.toMatchObject({ document: empty, origin: 'host', writable: true, migrated: false })
  })

  it('serves the cache read-only when the Host is unavailable', async () => {
    const cache = storage({ [GLOSSARY_CACHE_KEY]: JSON.stringify({ document: filled, savedAt: 1 }) })
    const subject = new ClientGlossaryStore({
      remote: remote({ read: vi.fn(async () => { throw new Error('offline') }) }),
      storage: cache
    })
    await expect(subject.load()).resolves.toMatchObject({ document: filled, origin: 'cache', writable: false })
    await expect(subject.save(filled, 1)).rejects.toThrow(/read-only/i)
  })

  it('migrates a non-empty cache into a Host that returned only its starter seed', async () => {
    const cache = storage({ [GLOSSARY_CACHE_KEY]: JSON.stringify({ document: filled, savedAt: 1 }) })
    const replace = vi.fn(async ({ document }: { document: GlossaryDocument }) => ({ ...document, revision: 1 }))
    const subject = new ClientGlossaryStore({
      remote: remote({ read: vi.fn(async () => ({ ...empty, origin: 'seed' as const })), replace }), storage: cache
    })
    const result = await subject.load()
    expect(replace).toHaveBeenCalledWith({ document: filled, expectedRevision: 0 })
    expect(result).toMatchObject({ migrated: true, origin: 'host' })
    expect(JSON.parse(cache.data.get(GLOSSARY_CACHE_KEY)!).document.revision).toBe(1)
  })

  it('surfaces a conflict instead of writing a stale document over newer edits', async () => {
    const cache = storage()
    const replace = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('glossary revision conflict: expected 1, actual 2'), { code: 'conflict' }))
    const host = remote({ read: vi.fn(async () => ({ ...filled, revision: 2 })), replace })
    const subject = new ClientGlossaryStore({ remote: host, storage: cache })
    await subject.load()
    await expect(subject.save(filled, 1)).rejects.toThrow(/conflict/i)
    expect(replace).toHaveBeenCalledOnce()
  })

  it('keeps an exhausted conflict visible and does not cache a wrong revision', async () => {
    const cache = storage({ [GLOSSARY_CACHE_KEY]: JSON.stringify({ document: filled, savedAt: 1 }) })
    const host = remote({
      read: vi.fn(async () => ({ ...filled, revision: 2 })),
      replace: vi.fn(async () => { throw Object.assign(new Error('conflict'), { code: 'conflict' }) })
    })
    const subject = new ClientGlossaryStore({ remote: host, storage: cache })
    await subject.load()
    await expect(subject.save(filled, 1)).rejects.toThrow(/conflict/i)
    expect(JSON.parse(cache.data.get(GLOSSARY_CACHE_KEY)!).document.revision).toBe(2)
  })

  it('does not fail a Host write when the cache quota is exceeded', async () => {
    const cache = storage()
    const host = remote({ read: vi.fn(async () => filled), replace: vi.fn(async ({ document }) => document) })
    const subject = new ClientGlossaryStore({ remote: host, storage: cache })
    await subject.load()
    cache.failNextWrite()
    await expect(subject.save(filled, 1)).resolves.toMatchObject({ document: filled })
  })
})

describe('ClientGlossaryStore legacy migration', () => {
  it('migrates a pre-Host cache when the Host only returned its starter seed', async () => {
    const cache = storage({ [GLOSSARY_CACHE_KEY]: JSON.stringify({ document: filled, savedAt: 1 }) })
    const seed = { ...empty, origin: 'seed' as const }
    const replace = vi.fn(async ({ document }: { document: GlossaryDocument }) => ({ ...document, revision: 1 }))
    const subject = new ClientGlossaryStore({ remote: remote({ read: vi.fn(async () => seed), replace }), storage: cache })

    const result = await subject.load()

    expect(replace).toHaveBeenCalledWith({ document: filled, expectedRevision: 0 })
    expect(result).toMatchObject({ migrated: true, origin: 'host' })
  })
})

describe('GlossaryController concurrent updates', () => {
  it('re-reads and applies a removal to the latest Host document after a conflict', async () => {
    const { GlossaryController } = await import('../src/glossary')
    const other: GlossaryEntry = {
      id: 'other', canonical: 'Other', variants: [], source: 'manual',
      confidence: 1, seen: 0, createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z'
    }
    let server: GlossaryDocument = { ...filled, revision: 1 }
    const replace = vi.fn(async ({ document, expectedRevision }: { document: GlossaryDocument; expectedRevision: number }) => {
      if (expectedRevision !== server.revision) throw Object.assign(new Error('conflict'), { code: 'conflict' })
      server = { ...document, revision: server.revision + 1 }
      return server
    })
    const remoteHost = remote({ read: vi.fn(async () => server), replace })
    const controller = new GlossaryController(new ClientGlossaryStore({ remote: remoteHost, storage: storage() }))
    await controller.load()
    // Another tab adds an entry after this tab rendered its snapshot.
    server = { ...server, revision: 2, entries: [entry, other] }

    await controller.updateEntries((entries) => entries.filter((item) => item.id !== entry.id))

    expect(server.entries).toEqual([other])
    expect(server.revision).toBe(3)
  })
})
