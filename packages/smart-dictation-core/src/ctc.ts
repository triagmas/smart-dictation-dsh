export interface DecodeCtcOptions {
  blankId: number
  timeSteps: number
  vocabSize: number
}

/**
 * Greedy CTC decode for a [timeSteps, vocabSize] logits/probability matrix.
 *
 * Pipeline: argmax per frame -> collapse equal neighbours -> drop blank ->
 * join vocabulary tokens -> SentencePiece word markers to spaces.
 */
export function decodeCtc(
  logits: Float32Array,
  vocab: readonly string[],
  options: DecodeCtcOptions
): string {
  const { blankId, timeSteps, vocabSize } = options

  if (!Number.isInteger(timeSteps) || timeSteps < 0) {
    throw new Error(`decodeCtc: invalid timeSteps ${timeSteps}`)
  }
  if (!Number.isInteger(vocabSize) || vocabSize <= 0 || vocabSize !== vocab.length) {
    throw new Error(`decodeCtc: invalid vocabSize ${vocabSize}`)
  }
  if (!Number.isInteger(blankId) || blankId < 0 || blankId >= vocabSize) {
    throw new Error(`decodeCtc: invalid blankId ${blankId}`)
  }
  if (logits.length !== timeSteps * vocabSize) {
    throw new Error(
      `decodeCtc: invalid shape, expected ${timeSteps * vocabSize} values, got ${logits.length}`
    )
  }

  let previous = -1
  let text = ''

  for (let t = 0; t < timeSteps; t += 1) {
    let best = 0
    let bestValue = logits[t * vocabSize]!
    for (let id = 1; id < vocabSize; id += 1) {
      const value = logits[t * vocabSize + id]!
      if (value > bestValue) {
        bestValue = value
        best = id
      }
    }

    if (best === previous) continue
    previous = best
    if (best === blankId) continue

    const token = vocab[best]!
    text += token.replace(/▁/gu, ' ')
  }

  return text.replace(/ +/g, ' ').trim()
}
