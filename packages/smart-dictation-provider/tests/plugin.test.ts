import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, name, inject } from '../src/index'

let root: string | undefined
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('smart-dictation host plugin', () => {
  it('registers a provider and removes it on dispose', async () => {
    root = await mkdtemp(join(tmpdir(), 'smart-dictation-plugin-'))
    const unregister = vi.fn(async () => undefined)
    const register = vi.fn((_provider: unknown) => unregister)
    let dispose: (() => Promise<void>) | undefined
    const ctx = {
      speechToText: { register },
      effect: (callback: () => () => Promise<void>) => {
        dispose = callback()
        return () => undefined
      },
      plugin: vi.fn(() => ({ dispose: async () => undefined }))
    }

    apply(ctx as never, { dataRoot: root, glossaryRoot: join(root, 'glossary'), threads: 2 })

    expect(name).toBe('smart-dictation')
    expect(inject).toContain('speechToText')
    expect(register).toHaveBeenCalledOnce()
    const provider = register.mock.calls[0]![0] as { info: { id: string; location: string } }
    expect(provider.info.id).toBe('gigaam-local')
    expect(provider.info.location).toBe('host-local')

    await dispose?.()
    expect(unregister).toHaveBeenCalledOnce()
  })

  it('rejects a relative data root', () => {
    const ctx = { speechToText: { register: vi.fn() }, effect: vi.fn(), plugin: vi.fn() }
    expect(() => apply(ctx as never, { dataRoot: 'relative', glossaryRoot: '/tmp/glossary', threads: 4 })).toThrow(/absolute/i)
  })
})
