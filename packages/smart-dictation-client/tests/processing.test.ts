import { describe, expect, it, vi } from 'vitest'
import { DictationController } from '../src/dictation'
import type { GlossaryEntry } from '@smart-dictation/core'

const entry: GlossaryEntry = {
  id: 'k8s', canonical: 'Kubernetes', variants: ['кубернетес'], source: 'manual',
  confidence: 1, seen: 0, createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z'
}
const wav = new Uint8Array([1, 2, 3])

function actions() {
  return {
    calls: [] as string[],
    captureInsertion() { this.calls.push('capture'); return { at: 1 } },
    insertText(text: string) { this.calls.push(`insert:${text}`); return true }
  }
}

describe('processed dictation', () => {
  it('runs cleanup and glossary replacement and reports the dictionary source', async () => {
    const input = actions()
    const transcribe = vi.fn(async () => ({ ok: true as const, value: { text: 'ну  задеплой кубернетес' } }))
    const subject = new DictationController({
      insert: input,
      transcribe,
      glossary: () => [entry],
      glossarySource: () => 'host'
    })
    subject.begin()
    const outcome = await subject.insert(wav)
    expect(outcome).toMatchObject({
      status: 'inserted',
      text: 'задеплой Kubernetes',
      raw: 'ну  задеплой кубернетес',
      replacements: 1,
      dictionarySource: 'host'
    })
    expect(outcome.status === 'inserted' && outcome.changes.length).toBeGreaterThan(0)
    expect(input.calls.at(-1)).toBe('insert:задеплой Kubernetes')
  })

  it('keeps the raw transcript available for “show source”', async () => {
    const subject = new DictationController({
      insert: actions(),
      transcribe: async () => ({ ok: true, value: { text: 'сырой текст' } })
    })
    subject.begin()
    const outcome = await subject.insert(wav)
    expect(outcome.status === 'inserted' && outcome.raw).toBe('сырой текст')
  })
})
