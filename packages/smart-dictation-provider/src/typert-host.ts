import { GLOSSARY_REMOTE } from './glossary-typert'

export const TYPERT = {
  package: '@triagmas/dsh-smart-dictation-provider',
  face: 'host',
  schemas: [],
  get invocations() { return GLOSSARY_REMOTE.descriptors },
  model: {
    services: [{
      description: 'Durable personal glossary stored in the plugin data directory.',
      summary: 'Durable personal glossary.',
      tags: [],
      jsDoc: '/** Durable personal glossary stored in the plugin data directory. */',
      key: 'glossary',
      exportName: 'GlossaryRemote',
      members: [{
        kind: 'method',
        name: 'read',
        signature: '@Remote read(): Promise<GlossaryDocument>',
        summary: 'Read the durable glossary document.',
        jsDoc: '/** Read the durable glossary document. */'
      }, {
        kind: 'method',
        name: 'replace',
        signature: '@Remote replace(request: GlossaryReplaceRequest): Promise<GlossaryDocument>',
        summary: 'Replace the glossary when the expected revision still matches.',
        jsDoc: '/** Replace the glossary when the expected revision still matches. */'
      }],
      types: [{
        name: 'GlossaryDocument',
        declaration: 'export interface GlossaryDocument { version: 1; revision: number; entries: GlossaryEntry[]; origin?: "seed" }'
      }, {
        name: 'GlossaryEntry',
        declaration: 'export interface GlossaryEntry { id: string; canonical: string; variants: string[]; source: "manual" | "learned" | "import"; confidence: number; seen: number; createdAt: string; updatedAt: string }'
      }, {
        name: 'GlossaryReplaceRequest',
        declaration: 'export interface GlossaryReplaceRequest { document: GlossaryDocument; expectedRevision: number }'
      }]
    }],
    events: [],
    objects: []
  }
}
