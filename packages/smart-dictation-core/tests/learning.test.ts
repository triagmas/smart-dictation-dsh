import { describe, expect, it } from 'vitest'
import { extractLearningCandidates } from '../src/learning'
import type { GlossaryEntry } from '../src/glossary'

const existing: GlossaryEntry[] = []

describe('extractLearningCandidates', () => {
  it('finds a Latin term corrected by the user', () => {
    const result = extractLearningCandidates({
      clean: 'задеплой кубернетес в прод',
      final: 'задеплой Kubernetes в прод',
      existing
    })
    expect(result).toEqual([{
      canonical: 'Kubernetes',
      variants: ['кубернетес'],
      occurrences: 1,
      score: expect.any(Number)
    }])
  })

  it('ignores punctuation-only and common-word edits', () => {
    expect(extractLearningCandidates({
      clean: 'сегодня', final: 'севодня', existing
    })).toEqual([])
  })

  it('ignores a correction to an existing canonical term', () => {
    expect(extractLearningCandidates({
      clean: 'кубернетес',
      final: 'Kubernetes',
      existing: [{
        id: 'k8s', canonical: 'Kubernetes', variants: ['кубернетес'],
        source: 'manual', confidence: 1, seen: 0,
        createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z'
      }]
    })).toEqual([])
  })
})

describe('learning a new variant of a known term', () => {
  const known: GlossaryEntry = {
    id: 'k8s', canonical: 'Kubernetes', variants: ['кубернетес'],
    source: 'manual', confidence: 1, seen: 0,
    createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z'
  }

  it('offers a correction for an existing canonical when the variant is new', () => {
    expect(extractLearningCandidates({
      clean: 'задеплой кубернетус в прод',
      final: 'задеплой Kubernetes в прод',
      existing: [known]
    })).toEqual([{
      canonical: 'Kubernetes',
      variants: ['кубернетус'],
      occurrences: 1,
      score: expect.any(Number)
    }])
  })

  it('does not offer a variant that is already known', () => {
    expect(extractLearningCandidates({
      clean: 'задеплой кубернетес в прод',
      final: 'задеплой Kubernetes в прод',
      existing: [known]
    })).toEqual([])
  })
})
