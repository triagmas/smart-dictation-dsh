import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { applyGlossaryRemote, GlossaryRemote } from '../src/glossary-remote'
import { GlossaryStore } from '../src/glossary-store'
import { TYPERT_REMOTE } from '../src/remote-client'
import { TYPERT } from '../src/typert-host'
import type { GlossaryDocument } from '@smart-dictation/core'

let root: string | undefined
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function context() {
  root = await mkdtemp(join(tmpdir(), 'smart-dictation-remote-'))
  return new Context()
}

const entry = {
  id: 'k8s', canonical: 'Kubernetes', variants: ['кубернетес'], source: 'manual' as const,
  confidence: 1, seen: 0, createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z'
}
const document: GlossaryDocument = { version: 1, revision: 0, entries: [entry] }

describe('glossary remote', () => {
  it('mounts under the glossary namespace and reads/replaces through the store', async () => {
    const ctx = await context()
    const remote = new GlossaryRemote(ctx, { glossaryRoot: root! })
    expect(remote.name).toBe('glossary')
    expect(remote.typertRemote.namespace).toBe('glossary')
    const initial = await remote.read()
    expect(initial).toMatchObject({ version: 1, revision: 0 })
    expect(initial.entries.some((item) => item.canonical === 'Kubernetes')).toBe(true)
    const written = await remote.replace({ document, expectedRevision: initial.revision })
    expect(written.revision).toBe(1)
    await expect(remote.read()).resolves.toEqual(written)
  })

  it('enforces entry and variant limits on the host', async () => {
    const ctx = await context()
    const remote = new GlossaryRemote(ctx, { glossaryRoot: root! })
    const tooManyVariants = { ...entry, variants: Array.from({ length: 33 }, (_, i) => `v${i}`) }
    await expect(remote.replace({ document: { ...document, entries: [tooManyVariants] }, expectedRevision: 0 }))
      .rejects.toThrow(/32/u)
    const tooManyEntries = Array.from({ length: 5001 }, (_, i) => ({ ...entry, id: `id${i}`, canonical: `Term${i}` }))
    await expect(remote.replace({ document: { ...document, entries: tooManyEntries }, expectedRevision: 0 }))
      .rejects.toThrow(/5000/u)
  })

  it('mounts through apply and unloads with its owner', async () => {
    const ctx = await context()
    ctx.provide('typert', {} as never)
    const fiber = await applyGlossaryRemote(ctx, { glossaryRoot: root! })
    const remote = ctx.get('glossary') as GlossaryRemote
    expect(remote).toBeInstanceOf(GlossaryRemote)
    await expect(remote.read()).resolves.toMatchObject({ revision: 0 })
    await fiber.dispose()
    expect(ctx.get('glossary')).toBeUndefined()
  })

  it('exposes matching host and client contracts', async () => {
    expect(TYPERT.package).toBe('@triagmas/dsh-smart-dictation-provider')
    expect(TYPERT.face).toBe('host')
    expect(TYPERT.invocations.map((item) => item.id).sort()).toEqual([
      '@triagmas/dsh-smart-dictation-provider#glossary/read',
      '@triagmas/dsh-smart-dictation-provider#glossary/replace'
    ])
    expect(Object.keys(TYPERT_REMOTE.methods).sort()).toEqual(['glossary/read', 'glossary/replace'])
    const request = TYPERT_REMOTE.methods['glossary/replace']!.input({ strict: true }).create()
    expect(() => request.parse({ request: { document, expectedRevision: 0 } })).not.toThrow()
    expect(() => request.parse({ request: { document, expectedRevision: 0 }, extra: true })).toThrow()
  })
})
