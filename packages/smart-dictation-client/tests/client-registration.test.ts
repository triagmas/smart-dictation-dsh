import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-experimental-api-speech-to-text/remote', () => ({ TYPERT_REMOTE: {} }))
vi.mock('@smart-dictation/dsh-provider/remote', () => ({ TYPERT_REMOTE: {} }))

import { apply } from '../src/client'

interface Registration {
  name: string
  key?: string
  id?: string
  inject?: () => unknown
}

function setup() {
  const registrations: Registration[] = []
  const injected: string[] = []
  const injections: { name: string; dispose: ReturnType<typeof vi.fn> }[] = []
  const services: string[] = []
  const context = {
    remote: {
      $mount: vi.fn(async () => vi.fn()),
      speech: {
        transcribe: vi.fn(),
        prepare: vi.fn()
      },
      glossary: {
        read: vi.fn(async () => ({ ok: true, value: { version: 1, revision: 0, entries: [{
          id: 'kubernetes', canonical: 'Kubernetes', variants: ['кубернетес'], source: 'manual',
          confidence: 1, seen: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
        }] } })),
        replace: vi.fn()
      }
    },
    slots: {
      inject(name: string, callback: () => unknown) {
        injected.push(name)
        callback()
        const dispose = vi.fn()
        injections.push({ name, dispose })
        return { dispose }
      },
      register(options: Registration) {
        registrations.push(options)
        return { dispose: vi.fn() }
      }
    },
    effect: vi.fn((callback: () => () => void) => callback()),
    get: vi.fn(() => undefined),
    inject(names: readonly string[], callback: (scope: unknown) => unknown) {
      services.push(...names)
      const result = Promise.resolve(callback(context))
      return Object.assign(result, { dispose: vi.fn(async () => {}) })
    }
  }
  return { context, registrations, injected, services }
}

describe('client registration', () => {
  it('adds a Smart Dictation page to Settings', async () => {
    const { context, registrations, injected, services } = setup()
    const dispose = await apply(context as never)
    expect(services).toEqual(['remote.speech', 'remote.glossary'])
    expect(injected).toContain('settings.section')
    expect(registrations).toContainEqual(expect.objectContaining({
      name: 'settings.section',
      id: 'smart-dictation',
      label: 'Smart Dictation'
    }))
    const actions = registrations.find((item) => item.name === 'settings.section')?.inject?.() as {
      glossary: { current: { document: { entries: { canonical: string }[] } } }
    } | undefined
    expect(actions?.glossary.current.document.entries.map((entry) => entry.canonical)).toEqual(['Kubernetes'])
    await dispose()
  })

  it('keeps the bundle page configuration entry', async () => {
    const { context, registrations } = setup()
    const dispose = await apply(context as never)
    expect(registrations).toContainEqual(expect.objectContaining({
      name: 'plugins.bundle.config',
      key: '@smart-dictation/dsh-bundle'
    }))
    await dispose()
  })
})
