export const MAX_ENTRIES = 5000
export const MAX_VARIANTS = 32

export type GlossarySource = 'manual' | 'learned' | 'import'

export interface GlossaryEntry {
  id: string
  canonical: string
  variants: string[]
  source: GlossarySource
  confidence: number
  seen: number
  createdAt: string
  updatedAt: string
}

export interface GlossaryDocument {
  version: 1
  revision: number
  entries: GlossaryEntry[]
  /**
   * Host response marker: this document is the in-memory starter vocabulary,
   * not a file on disk. It lets the client migrate a pre-Host cache instead of
   * mistaking the seed for user data.
   */
  origin?: 'seed'
}

export interface GlossaryCandidate {
  canonical: string
  variants: string[]
  source?: GlossarySource
  confidence?: number
}

function compareTerm(left: string, right: string): boolean {
  return left.toLocaleLowerCase('ru-RU') === right.toLocaleLowerCase('ru-RU')
}

function slug(value: string): string {
  const normalized = value
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized || 'term'
}

export function validateGlossaryDocument(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['document must be an object']
  const document = value as Partial<GlossaryDocument>
  const errors: string[] = []
  if (document.version !== 1) errors.push('version must be 1')
  if (!Number.isInteger(document.revision) || (document.revision ?? -1) < 0) {
    errors.push('revision must be a non-negative integer')
  }
  if (!Array.isArray(document.entries)) {
    errors.push('entries must be an array')
    return errors
  }
  if (document.entries.length > MAX_ENTRIES) errors.push(`entries must contain at most ${MAX_ENTRIES} items`)
  for (const entry of document.entries) {
    if (!entry || typeof entry !== 'object') {
      errors.push('each entry must be an object')
      continue
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) errors.push('entry id is required')
    if (typeof entry.canonical !== 'string' || entry.canonical.trim().length === 0) {
      errors.push('entry canonical is required')
    }
    if (!Array.isArray(entry.variants) || entry.variants.length > MAX_VARIANTS) {
      errors.push(`entry variants must contain at most ${MAX_VARIANTS} items`)
    }
  }
  return errors
}

/**
 * Add a candidate term to a glossary without mutating the input.
 * Existing canonical terms are case-insensitively merged; variants keep their first spelling.
 */
export function mergeCandidate(
  entries: readonly GlossaryEntry[],
  candidate: GlossaryCandidate,
  now = new Date().toISOString()
): GlossaryEntry[] {
  const canonical = candidate.canonical.trim()
  if (canonical.length === 0) throw new Error('canonical term is required')

  const variants = candidate.variants
    .map((variant) => variant.trim())
    .filter((variant) => variant.length > 0)
  if (variants.length === 0) throw new Error('at least one variant is required')
  if (variants.length > MAX_VARIANTS) {
    throw new Error(`variants must contain at most ${MAX_VARIANTS} items`)
  }

  const existingIndex = entries.findIndex((entry) => compareTerm(entry.canonical, canonical))
  if (existingIndex === -1 && entries.length >= MAX_ENTRIES) {
    throw new Error(`entries must contain at most ${MAX_ENTRIES} items`)
  }

  if (existingIndex === -1) {
    return [
      ...entries,
      {
        id: slug(canonical),
        canonical,
        variants,
        source: candidate.source ?? 'learned',
        confidence: candidate.confidence ?? 0.5,
        seen: 0,
        createdAt: now,
        updatedAt: now
      }
    ]
  }

  const existing = entries[existingIndex]!
  const mergedVariants = [...existing.variants]
  for (const variant of variants) {
    if (!mergedVariants.some((known) => compareTerm(known, variant))) {
      mergedVariants.push(variant)
    }
  }
  if (mergedVariants.length > MAX_VARIANTS) {
    throw new Error(`variants must contain at most ${MAX_VARIANTS} items`)
  }

  return entries.map((entry, index) => index === existingIndex
    ? { ...entry, variants: mergedVariants, updatedAt: now }
    : entry)
}
