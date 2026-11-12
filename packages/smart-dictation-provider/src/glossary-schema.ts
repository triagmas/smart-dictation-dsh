import { z } from 'zod'
import type { GlossaryDocument, GlossaryEntry } from '@smart-dictation/core'

export const glossaryEntrySchema = z.object({
  id: z.string().min(1),
  canonical: z.string().min(1),
  variants: z.array(z.string().min(1)).max(32),
  source: z.enum(['manual', 'learned', 'import']),
  confidence: z.number().min(0).max(1),
  seen: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
})

export const glossaryDocumentSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  entries: z.array(glossaryEntrySchema).max(5000),
  origin: z.literal('seed').optional()
})

export const glossaryReplaceRequestSchema = z.object({
  document: glossaryDocumentSchema,
  expectedRevision: z.number().int().nonnegative()
})

export type GlossaryReplaceRequest = {
  document: GlossaryDocument
  expectedRevision: number
}

export function parseGlossaryDocument(value: unknown): GlossaryDocument {
  const parsed = glossaryDocumentSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join('.') || 'document'
    throw new Error(`invalid glossary document at ${path}: ${issue?.message ?? 'validation failed'}`)
  }
  return parsed.data as GlossaryDocument
}

export function parseGlossaryEntry(value: unknown): GlossaryEntry {
  const parsed = glossaryEntrySchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join('.') || 'entry'
    throw new Error(`invalid glossary entry at ${path}: ${issue?.message ?? 'validation failed'}`)
  }
  return parsed.data as GlossaryEntry
}
