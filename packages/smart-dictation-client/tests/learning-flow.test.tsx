import { describe, expect, it, vi } from 'vitest'
import { LearningController } from '../src/learning'
import type { GlossaryEntry } from '@smart-dictation/core'

const latency: GlossaryEntry = {
  id: 'latency', canonical: 'latency', variants: ['латентность'], source: 'manual',
  confidence: 1, seen: 0, createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z'
}

function setup(entries: GlossaryEntry[] = [], enabled = true) {
  const replaced: GlossaryEntry[][] = []
  const glossary = {
    entries,
    replaceEntries: vi.fn(async (next: readonly GlossaryEntry[]) => {
      replaced.push([...next])
      return { document: { version: 1, revision: replaced.length, entries: [...next] } }
    })
  }
  const subject = new LearningController({ glossary, enabled: () => enabled, now: () => '2026-11-12T00:00:00Z' })
  return { subject, glossary, replaced }
}

describe('LearningController', () => {
  it('learns from the edited draft before it is cleared by sending', () => {
    const { subject } = setup()
    subject.recordDictation({ raw: 'задеплой', clean: 'задеплой кубернетес', draftRev: 3 })
    subject.observe({ draft: 'задеплой Kubernetes', draftRev: 3, phase: 'plain' })
    subject.observe({ draft: '', draftRev: 4, phase: 'sending' })
    expect(subject.current).toMatchObject({
      status: 'open',
      candidates: [{ canonical: 'Kubernetes', variants: ['кубернетес'] }]
    })
  })

  it('does not show a card when punctuation or an ordinary word changed', () => {
    const { subject } = setup()
    subject.recordDictation({ raw: 'сегодня', clean: 'сегодня', draftRev: 1 })
    subject.observe({ draft: 'сегодня.', draftRev: 2, phase: 'plain' })
    subject.observe({ draft: '', draftRev: 3, phase: 'sending' })
    expect(subject.current).toBeUndefined()
  })

  it('does not learn the same dictation twice', () => {
    const { subject } = setup()
    subject.recordDictation({ raw: 'x', clean: 'Кубернетес', draftRev: 1 })
    subject.observe({ draft: 'Kubernetes', draftRev: 1, phase: 'plain' })
    subject.observe({ draft: '', draftRev: 2, phase: 'sending' })
    subject.reject()
    subject.observe({ draft: 'Кубернетес Kubernetes', draftRev: 3, phase: 'plain' })
    subject.observe({ draft: '', draftRev: 4, phase: 'sending' })
    expect(subject.current).toBeUndefined()
  })

  it('closes an older card when a new dictation starts', () => {
    const { subject } = setup()
    subject.recordDictation({ raw: 'x', clean: 'задеплой кубернетес', draftRev: 1 })
    subject.observe({ draft: 'задеплой Kubernetes', draftRev: 1, phase: 'plain' })
    subject.observe({ draft: '', draftRev: 2, phase: 'sending' })
    expect(subject.current).toBeDefined()
    subject.recordDictation({ raw: 'y', clean: 'привет', draftRev: 3 })
    expect(subject.current).toBeUndefined()
  })

  it('accepts candidates into the glossary and rejects without writing', async () => {
    const { subject, replaced } = setup([latency])
    subject.recordDictation({ raw: 'x', clean: 'задеплой кубернетес', draftRev: 1 })
    subject.observe({ draft: 'задеплой Kubernetes', draftRev: 1, phase: 'plain' })
    subject.observe({ draft: '', draftRev: 2, phase: 'sending' })
    await subject.accept()
    expect(replaced).toHaveLength(1)
    expect(replaced[0]!.map((entry) => entry.canonical)).toEqual(['latency', 'Kubernetes'])
    expect(subject.current).toBeUndefined()
  })

  it('keeps the card open with the Host error', async () => {
    const { subject, glossary } = setup()
    glossary.replaceEntries.mockRejectedValueOnce(new Error('offline'))
    subject.recordDictation({ raw: 'x', clean: 'задеплой кубернетес', draftRev: 1 })
    subject.observe({ draft: 'задеплой Kubernetes', draftRev: 1, phase: 'plain' })
    subject.observe({ draft: '', draftRev: 2, phase: 'sending' })
    await subject.accept()
    expect(subject.current).toMatchObject({ status: 'error', error: 'offline' })
  })

  it('does not show a card when learning is disabled', () => {
    const { subject } = setup([], false)
    subject.recordDictation({ raw: 'x', clean: 'задеплой кубернетес', draftRev: 1 })
    subject.observe({ draft: 'задеплой Kubernetes', draftRev: 1, phase: 'plain' })
    subject.observe({ draft: '', draftRev: 2, phase: 'sending' })
    expect(subject.current).toBeUndefined()
  })
})
