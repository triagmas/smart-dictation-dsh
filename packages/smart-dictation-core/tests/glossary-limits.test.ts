import { describe, expect, it } from 'vitest'
import { MAX_ENTRIES, MAX_VARIANTS, mergeCandidate } from '../src/glossary'
import type { GlossaryEntry } from '../src/glossary'

function entry(index: number): GlossaryEntry {
  return {
    id: `e${index}`,
    canonical: `Term${index}`,
    variants: [`term${index}`],
    source: 'manual',
    confidence: 1,
    seen: 0,
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z'
  }
}

describe('glossary limits', () => {
  it('rejects an empty canonical term', () => {
    expect(() => mergeCandidate([], { canonical: '  ', variants: ['x'] }))
      .toThrow(/canonical/i)
  })

  it('rejects more than 32 variants', () => {
    expect(() => mergeCandidate([], {
      canonical: 'Kubernetes',
      variants: Array.from({ length: MAX_VARIANTS + 1 }, (_, index) => `v${index}`)
    })).toThrow(/variants/i)
  })

  it('rejects a new entry when 5000 already exist', () => {
    const entries = Array.from({ length: MAX_ENTRIES }, (_, index) => entry(index))
    expect(() => mergeCandidate(entries, { canonical: 'NewTerm', variants: ['newterm'] }))
      .toThrow(/entries/i)
  })

  it('merges variants without duplicates and preserves createdAt', () => {
    const before: GlossaryEntry[] = [{
      ...entry(1),
      canonical: 'Kubernetes',
      variants: ['кубернетес'],
      createdAt: '2020-01-01T00:00:00Z'
    }]
    const after = mergeCandidate(before, {
      canonical: 'Kubernetes',
      variants: ['Кубернетес', 'кубернетс']
    })
    expect(after).toHaveLength(1)
    expect(after[0]!.createdAt).toBe('2020-01-01T00:00:00Z')
    expect(after[0]!.variants).toEqual(['кубернетес', 'кубернетс'])
  })
})
