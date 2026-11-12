import type { GlossaryEntry } from './glossary'

export interface LearningCandidate {
  canonical: string
  variants: string[]
  occurrences: number
  score: number
}

export interface LearningInput {
  clean: string
  final: string
  existing: readonly GlossaryEntry[]
}

const TOKEN = /\p{L}[\p{L}\p{N}_.+#-]*/gu
const LATIN_TERM = /^[A-Za-z][A-Za-z0-9_.+#-]*$/u
const CAPITALIZED = /^\p{Lu}[\p{L}\p{N}_.+#-]*$/u

interface Token {
  value: string
  index: number
}

function tokens(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((match) => ({
    value: match[0],
    index: match.index ?? 0
  }))
}

function isSentenceStart(text: string, index: number): boolean {
  const before = text.slice(0, index).trimEnd()
  return before.length === 0 || /[.!?]$/u.test(before)
}

function looksLikeTerm(token: Token, text: string): boolean {
  if (LATIN_TERM.test(token.value)) return true
  if (!CAPITALIZED.test(token.value)) return false
  return !isSentenceStart(text, token.index)
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]!
    previous[0] = i
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j]!
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      previous[j] = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + cost)
      diagonal = above
    }
  }
  return previous[right.length]!
}

/**
 * Find only user-confirmed term corrections; never learns punctuation or common-word typos.
 */
export function extractLearningCandidates(input: LearningInput): LearningCandidate[] {
  const cleanTokens = tokens(input.clean)
  const finalTokens = tokens(input.final)
  if (cleanTokens.length !== finalTokens.length) return []

  const variantsByCanonical = new Map<string, Set<string>>()
  for (const entry of input.existing) {
    const canonical = entry.canonical.toLocaleLowerCase('ru-RU')
    const known = variantsByCanonical.get(canonical) ?? new Set<string>()
    for (const variant of entry.variants) known.add(variant.toLocaleLowerCase('ru-RU'))
    variantsByCanonical.set(canonical, known)
  }
  const candidates = new Map<string, LearningCandidate>()

  for (let index = 0; index < cleanTokens.length; index += 1) {
    const source = cleanTokens[index]!
    const final = finalTokens[index]!
    if (source.value === final.value) continue
    if (!looksLikeTerm(final, input.final)) continue
    // A known canonical term can still learn a new pronunciation; only the
    // exact variant already attached to it is a duplicate.
    const knownVariants = variantsByCanonical.get(final.value.toLocaleLowerCase('ru-RU'))
    if (knownVariants?.has(source.value.toLocaleLowerCase('ru-RU'))) continue

    const key = `${final.value.toLocaleLowerCase('ru-RU')}\u0000${source.value.toLocaleLowerCase('ru-RU')}`
    const current = candidates.get(key)
    if (current) {
      current.occurrences += 1
      continue
    }

    const distance = levenshtein(source.value.toLocaleLowerCase('ru-RU'), final.value.toLocaleLowerCase('ru-RU'))
    const longest = Math.max(source.value.length, final.value.length, 1)
    candidates.set(key, {
      canonical: final.value,
      variants: [source.value],
      occurrences: 1,
      score: Math.max(0.1, 1 - distance / longest)
    })
  }

  return [...candidates.values()]
}
