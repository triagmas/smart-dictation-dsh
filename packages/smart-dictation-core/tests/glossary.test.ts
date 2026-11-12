import { describe, expect, it } from 'vitest'
import { processTranscript } from '../src/text'
import type { GlossaryEntry } from '../src/glossary'

const entries: GlossaryEntry[] = [{
  id: 'k8s',
  canonical: 'Kubernetes',
  variants: ['кубернетес', 'кубернетс', 'кибернетис'],
  source: 'manual',
  confidence: 1,
  seen: 0,
  createdAt: '2026-11-12T00:00:00Z',
  updatedAt: '2026-11-12T00:00:00Z'
}]

describe('glossary replacement', () => {
  it('replaces a variant and keeps canonical case', () => {
    expect(processTranscript('задеплой кубернетес в прод', entries).clean)
      .toBe('задеплой Kubernetes в прод')
  })

  it('does not replace substrings', () => {
    const text = 'package.json, C++, up -d'
    expect(processTranscript(text, entries).clean).toBe(text)
  })

  it('prefers the longest variant in one pass', () => {
    const longEntries: GlossaryEntry[] = [{
      ...entries[0]!,
      variants: ['кубернетес', 'кубернетес в прод']
    }]
    expect(processTranscript('кубернетес в прод', longEntries).clean)
      .toBe('Kubernetes')
  })

  it('maps close phonetic variants to one Latin term', () => {
    const text = 'кибернетис, кубернетус, кгубернетес, кубернетес'
    expect(processTranscript(text, entries).clean)
      .toBe('Kubernetes, Kubernetes, Kubernetes, Kubernetes')
  })

  it('does not fuzzy-replace unrelated Russian words', () => {
    expect(processTranscript('кибернетика и контейнер', entries).clean)
      .toBe('кибернетика и контейнер')
  })

  it('is case-insensitive and does not cascade', () => {
    expect(processTranscript('КУБЕРНЕТЕС', entries).clean).toBe('Kubernetes')
    expect(processTranscript('Kubernetes', entries).clean).toBe('Kubernetes')
  })
})

describe('fuzzy glossary safety', () => {
  const seedLike: GlossaryEntry[] = [{
    id: 'k8s',
    canonical: 'Kubernetes',
    variants: ['кубернетес', 'кубернетис', 'кибернетис', 'кгубернетес', 'кубернетс'],
    source: 'import',
    confidence: 1,
    seen: 0,
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z'
  }, {
    id: 'electron',
    canonical: 'Electron',
    variants: ['электрон'],
    source: 'import',
    confidence: 1,
    seen: 0,
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z'
  }]

  it('does not turn ordinary Russian words into seeded Latin terms', () => {
    expect(processTranscript('кибернетика и электроны', seedLike).clean)
      .toBe('кибернетика и электроны')
  })

  it('still corrects an unseen close spelling of a seeded term', () => {
    expect(processTranscript('кубернетус', seedLike).clean).toBe('Kubernetes')
  })
})
