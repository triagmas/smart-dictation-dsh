import type { GlossaryEntry } from './glossary'

export const DEFAULT_FILLERS = [
  'как бы',
  'в общем',
  'это самое',
  'так сказать',
  'понимаешь',
  'собственно',
  'короче',
  'значит',
  'скажем',
  'типа',
  'ну',
  'э-э',
  'ээ',
  'ммм'
] as const

export type TextChangeKind = 'spacing' | 'punctuation' | 'filler' | 'repeat' | 'glossary'

export interface TextChange {
  kind: TextChangeKind
  from: string
  to: string
}

export interface ProcessOptions {
  fillers?: readonly string[]
  collapseRepeats?: boolean
  applyGlossary?: boolean
}

export interface ProcessResult {
  raw: string
  clean: string
  changes: TextChange[]
}

const WORD = '[\\p{L}\\p{N}_-]+'

export function normalizeSpacing(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

export function normalizePunctuation(text: string): string {
  return text
    .replace(/\s+([.,!?;:])/gu, '$1')
    .replace(/,\s*,+/gu, ',')
    .replace(/([,;:])\s*([.!?])/gu, '$2')
    .replace(/([.,!?;:])(?=\p{L})/gu, (match, punctuation: string, offset: number, source: string) => {
      if (punctuation !== '.') return `${punctuation} `
      const previous = source[offset - 1] ?? ''
      const next = source[offset + 1] ?? ''
      // Keep decimals, initials, and abbreviations such as "3.14", "А.Б.", "т.е.".
      if (!/\p{Lu}/u.test(next) || /\p{Lu}/u.test(previous)) return match
      return `${punctuation} `
    })
    .replace(/^[\s,;:]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function fillerPattern(filler: string): string {
  return filler
    .trim()
    .split(/\s+/u)
    .map(escapeRegExp)
    .join('\\s+')
}

/**
 * Words that are also ordinary sentence parts. They are removed only when the
 * punctuation marks them as parenthetical, never as a predicate:
 * "это значит, что" keeps the verb, while "это, значит, важно" drops it.
 */
const CONTEXTUAL_FILLERS = new Set(['значит', 'скажем', 'типа', 'собственно'])

export function removeFillers(
  text: string,
  fillers: readonly string[] = DEFAULT_FILLERS
): string {
  let result = text
  const ordered = [...fillers]
    .map((filler) => filler.trim())
    .filter((filler) => filler.length > 0)
    .sort((left, right) => right.length - left.length)

  for (const filler of ordered) {
    const phrase = fillerPattern(filler)
    const boundaryBefore = '(?<![\\p{L}\\p{N}_])'
    const boundaryAfter = '(?![\\p{L}\\p{N}_])'
    // "Ну, ..." / "... , ну, ..." — filler plus its trailing comma.
    result = result.replace(
      new RegExp(`(^|[.,!?;:]\\s*)${boundaryBefore}(?:${phrase})\\s*,\\s*`, 'giu'),
      '$1'
    )
    if (!CONTEXTUAL_FILLERS.has(filler.toLocaleLowerCase('ru-RU'))) {
      // "... , ну" at the end or before sentence punctuation.
      result = result.replace(
        new RegExp(`,?\\s*${boundaryBefore}(?:${phrase})${boundaryAfter}(?=\\s*[.,!?;:]|$)`, 'giu'),
        ''
      )
    } else {
      // "... , значит" after a comma at the end of a clause.
      result = result.replace(
        new RegExp(`,\\s*${boundaryBefore}(?:${phrase})${boundaryAfter}(?=\\s*[.,!?;:]|$)`, 'giu'),
        ''
      )
    }
    // Leading "ну ..." without the comma the ASR often omits.
    result = result.replace(
      new RegExp(`^${boundaryBefore}(?:${phrase})(?=\\s|[.,!?;:]|$)`, 'giu'),
      ''
    )
  }

  return result
}

export function collapseRepeats(text: string): string {
  const repeatedWord = new RegExp(
    `(?<![\\p{L}\\p{N}_-])(${WORD})(?:\\s+\\1)+(?![\\p{L}\\p{N}_-])`,
    'giu'
  )
  const repeatedBigram = new RegExp(
    `(?<![\\p{L}\\p{N}_-])(${WORD}\\s+${WORD})(?:\\s+\\1)+(?![\\p{L}\\p{N}_-])`,
    'giu'
  )
  return text.replace(repeatedBigram, '$1').replace(repeatedWord, '$1')
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

export function applyGlossary(
  text: string,
  entries: readonly GlossaryEntry[]
): { text: string; changes: TextChange[] } {
  const variants = new Map<string, string>()
  for (const entry of entries) {
    if (!entry.canonical.trim()) continue
    for (const rawVariant of entry.variants) {
      const variant = rawVariant.trim()
      if (!variant) continue
      const key = variant.toLocaleLowerCase('ru-RU')
      if (!variants.has(key)) variants.set(key, entry.canonical)
    }
  }

  if (variants.size === 0) return { text, changes: [] }

  const ordered = [...variants.entries()].sort(
    ([left], [right]) => right.length - left.length
  )
  const alternatives = ordered.map(([variant]) => escapeRegExp(variant)).join('|')
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`,
    'giu'
  )

  const changes: TextChange[] = []
  const replaced = text.replace(pattern, (match) => {
    const canonical = variants.get(match.toLocaleLowerCase('ru-RU'))
    if (canonical === undefined) return match
    if (canonical !== match) changes.push({ kind: 'glossary', from: match, to: canonical })
    return canonical
  })

  // ASR frequently hears a Latin term in several close Russian spellings.
  // Correct only long, single-word variants of Latin terms, where a small edit
  // distance is strong evidence and cannot mangle ordinary Russian words.
  const fuzzy = new Map<string, string>()
  for (const entry of entries) {
    if (!/[A-Za-z]/u.test(entry.canonical)) continue
    for (const rawVariant of entry.variants) {
      const variant = rawVariant.trim()
      if (variant.length < 8 || /\s/u.test(variant)) continue
      const key = variant.toLocaleLowerCase('ru-RU')
      if (!fuzzy.has(key)) fuzzy.set(key, entry.canonical)
    }
  }

  if (fuzzy.size === 0) return { text: replaced, changes }

  const corrected = replaced.replace(
    /(?<![\p{L}\p{N}_])([\p{L}][\p{L}\p{N}_-]*)(?![\p{L}\p{N}_])/gu,
    (match) => {
      const key = match.toLocaleLowerCase('ru-RU')
      if (key.length < 8) return match
      let selected: { canonical: string; distance: number } | undefined
      for (const [variant, canonical] of fuzzy) {
        if (variant.length < 8 || variant[0] !== key[0]) continue
        // A shared first character alone is too weak: it turns "кибернетика"
        // into "кибернетис" and "электроны" into "электрон". ASR confusions
        // keep the final consonant, so require both edges and allow a second
        // edit only for long terms.
        if (variant[variant.length - 1] !== key[key.length - 1]) continue
        const distance = levenshtein(key, variant)
        const limit = variant.length >= 12 ? 2 : 1
        if (distance === 0 || distance > limit) continue
        if (selected === undefined || distance < selected.distance) {
          selected = { canonical, distance }
        }
      }
      if (selected === undefined) return match
      changes.push({ kind: 'glossary', from: match, to: selected.canonical })
      return selected.canonical
    }
  )

  return { text: corrected, changes }
}

export function processTranscript(
  raw: string,
  entries: readonly GlossaryEntry[] = [],
  options: ProcessOptions = {}
): ProcessResult {
  const changes: TextChange[] = []
  let text = normalizeSpacing(raw)
  if (text !== raw.trim()) changes.push({ kind: 'spacing', from: raw, to: text })

  const punctuated = normalizePunctuation(text)
  if (punctuated !== text) changes.push({ kind: 'punctuation', from: text, to: punctuated })
  text = punctuated

  const withoutFillers = normalizePunctuation(
    removeFillers(text, options.fillers ?? DEFAULT_FILLERS)
  )
  if (withoutFillers !== text) changes.push({ kind: 'filler', from: text, to: withoutFillers })
  text = withoutFillers

  if (options.collapseRepeats !== false) {
    const withoutRepeats = normalizePunctuation(collapseRepeats(text))
    if (withoutRepeats !== text) changes.push({ kind: 'repeat', from: text, to: withoutRepeats })
    text = withoutRepeats
  }

  if (options.applyGlossary !== false) {
    const result = applyGlossary(text, entries)
    text = result.text
    changes.push(...result.changes)
  }

  return { raw, clean: text, changes }
}
