import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GlossaryConflictError, GlossaryCorruptError, GlossaryStore, type GlossaryStoreOptions } from '../src/glossary-store'
import { applyGlossary, type GlossaryDocument } from '@smart-dictation/core'
import { parseGlossaryDocument } from '../src/glossary-schema'

let root: string | undefined
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function store(options: Omit<GlossaryStoreOptions, 'root'> = {}) {
  root = await mkdtemp(join(tmpdir(), 'smart-dictation-glossary-'))
  return new GlossaryStore({ root, ...options })
}

const entry = {
  id: 'k8s',
  canonical: 'Kubernetes',
  variants: ['кубернетес'],
  source: 'manual' as const,
  confidence: 1,
  seen: 0,
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z'
}

function doc(revision = 0, entries = [entry]): GlossaryDocument {
  return { version: 1, revision, entries }
}

describe('GlossaryStore', () => {
  it('seeds common terms when no file exists', async () => {
    const subject = await store()
    const document = await subject.read()
    expect(document.revision).toBe(0)
    expect(document.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonical: 'Kubernetes' }),
      expect.objectContaining({ canonical: 'DSH' })
    ]))
  })

  it('seeds programming languages and project terms', async () => {
    const subject = await store()
    const { entries } = await subject.read()
    const canonicals = new Set(entries.map((item) => item.canonical))
    for (const term of ['C++', 'C#', 'Rust', 'GraphQL', 'Codex', 'TypeScript']) {
      expect(canonicals.has(term)).toBe(true)
    }
  })

  it('maps seeded programming-language spellings', async () => {
    const subject = await store()
    const { entries } = await subject.read()
    const result = applyGlossary('пиши на си плюс плюс и раст, а не на джаве', entries)
    expect(result.text).toContain('C++')
    expect(result.text).toContain('Rust')
    expect(result.text).toContain('Java')
  })

  it('seeds a valid glossary with unique entry ids', async () => {
    const subject = await store()
    const document = await subject.read()
    expect(() => parseGlossaryDocument(document)).not.toThrow()
    expect(new Set(document.entries.map((item) => item.id)).size).toBe(document.entries.length)
  })

  it('does not reseed after the user clears the glossary', async () => {
    const subject = await store()
    const seeded = await subject.read()
    const cleared = await subject.replace({ ...seeded, entries: [] }, seeded.revision)
    expect(cleared.entries).toEqual([])
    await expect(subject.read()).resolves.toEqual(cleared)
  })

  it('increments revision, keeps a backup and reads the replacement', async () => {
    const subject = await store()
    const first = await subject.replace(doc(), 0)
    expect(first.revision).toBe(1)
    const second = await subject.replace({ ...first, entries: [{ ...entry, canonical: 'Kubernetes' }] }, 1)
    expect(second.revision).toBe(2)
    await expect(subject.read()).resolves.toEqual(second)
    const backup = JSON.parse(await readFile(join(root!, 'glossary.bak.json'), 'utf8'))
    expect(backup.revision).toBe(1)
  })

  it('rejects a stale expected revision without changing the file', async () => {
    const subject = await store()
    await subject.replace(doc(), 0)
    await expect(subject.replace(doc(0), 0)).rejects.toBeInstanceOf(GlossaryConflictError)
    await expect(subject.read()).resolves.toMatchObject({ revision: 1, entries: [entry] })
  })

  it('quarantines corrupt JSON and never overwrites it with empty data', async () => {
    const subject = await store()
    await writeFile(join(root!, 'glossary.json'), '{ not json')
    await expect(subject.read()).rejects.toBeInstanceOf(GlossaryCorruptError)
    await expect(readFile(join(root!, 'glossary.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const files = await readdir(root!)
    expect(files.some((name) => name.startsWith('glossary.corrupt-') && name.endsWith('.json'))).toBe(true)
  })

  it('restores a valid backup after corruption', async () => {
    const subject = await store()
    await subject.replace(doc(), 0)
    await subject.replace(doc(1, [{ ...entry, canonical: 'Kubernetes' }]), 1)
    await writeFile(join(root!, 'glossary.json'), '{ broken')
    const restored = await subject.repair()
    expect(restored.entries).toEqual([entry])
    expect(restored.revision).toBeGreaterThan(1)
    await expect(subject.read()).resolves.toEqual(restored)
  })

  it('leaves the old file intact when rename fails', async () => {
    const initial = await store()
    await initial.replace(doc(), 0)
    const failing = new GlossaryStore({
      root: root!,
      rename: async () => { throw new Error('rename failed') }
    })
    await expect(failing.replace(doc(1), 1)).rejects.toThrow(/rename failed/u)
    await expect(initial.read()).resolves.toMatchObject({ revision: 1, entries: [entry] })
  })

  it('requires an absolute root', () => {
    expect(() => new GlossaryStore({ root: 'relative' })).toThrow(/absolute/i)
  })

  it('rejects metadata outside the schema', async () => {
    const subject = await store()
    await expect(subject.replace(doc(0, [{ ...entry, source: 'bogus' } as never]), 0))
      .rejects.toThrow(/source|invalid/iu)
  })
})

describe('GlossaryStore repair ordering', () => {
  it('restores the backup even after a failed read already quarantined the file', async () => {
    const subject = await store()
    await subject.replace(doc(), 0)
    await subject.replace(doc(1, [{ ...entry, canonical: 'Kubernetes' }]), 1)
    await writeFile(join(root!, 'glossary.json'), '{ broken')
    await expect(subject.read()).rejects.toBeInstanceOf(GlossaryCorruptError)
    const restored = await subject.repair()
    expect(restored.entries).toEqual([entry])
    expect(restored.revision).toBe(2)
    await expect(subject.read()).resolves.toEqual(restored)
  })
})
