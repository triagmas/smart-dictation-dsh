import { describe, expect, it } from 'vitest'
import { decodeCtc } from '../src/ctc'

const vocab = ['<unk>', '▁', 'п', 'р', 'и', 'в', 'е', 'т', '<blk>']
const opts = { blankId: 8, timeSteps: 0, vocabSize: vocab.length }

function logitsFor(vocabulary: readonly string[], tokens: number[]): Float32Array {
  const out = new Float32Array(tokens.length * vocabulary.length).fill(-10)
  tokens.forEach((id, t) => { out[t * vocabulary.length + id] = 10 })
  return out
}

function logits(tokens: number[]): Float32Array {
  const out = new Float32Array(tokens.length * vocab.length).fill(-10)
  tokens.forEach((id, t) => { out[t * vocab.length + id] = 10 })
  return out
}

describe('decodeCtc', () => {
  it('collapse + blank + word boundary', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7]
    expect(decodeCtc(logits(ids), vocab, { ...opts, timeSteps: ids.length }))
      .toBe('привет привет')
  })

  it('repeats without blank collapse', () => {
    const ids = [1, 2, 2, 3]
    expect(decodeCtc(logits(ids), vocab, { ...opts, timeSteps: ids.length })).toBe('пр')
  })

  it('expands SentencePiece markers attached to word tokens', () => {
    const attached = ['<unk>', '▁сегодня', '▁утром', '▁я', '<blk>']
    const ids = [1, 2, 3, 4]
    expect(decodeCtc(logitsFor(attached, ids), attached, {
      blankId: 4,
      timeSteps: ids.length,
      vocabSize: attached.length
    })).toBe('сегодня утром я')
  })

  it('trailing word marker is trimmed', () => {
    const ids = [1, 2, 3, 1]
    expect(decodeCtc(logits(ids), vocab, { ...opts, timeSteps: ids.length })).toBe('пр')
  })

  it('rejects inconsistent shapes', () => {
    expect(() => decodeCtc(new Float32Array(4), vocab, opts)).toThrow(/shape/i)
  })
})
