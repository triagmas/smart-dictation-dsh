import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import { glossaryDocumentSchema, glossaryReplaceRequestSchema } from './glossary-schema'

const documentCodec = {
  mode: 'strict' as const,
  typeSymbol: '@smart-dictation/dsh-provider#GlossaryDocument',
  create: () => glossaryDocumentSchema
}

const requestCodec = {
  mode: 'strict' as const,
  typeSymbol: '@smart-dictation/dsh-provider#GlossaryReplaceRequest',
  create: () => glossaryReplaceRequestSchema
}

export const GLOSSARY_REMOTE = createTypertRemoteInfo({
  package: '@smart-dictation/dsh-provider',
  methods: {
    'glossary/read': {
      service: 'glossary',
      description: 'Read the durable glossary document.',
      invocation: { kind: 'direct' },
      parameters: [],
      result: documentCodec
    },
    'glossary/replace': {
      service: 'glossary',
      description: 'Replace the glossary when the expected revision still matches.',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'request',
        description: 'validated document and the revision it was based on.',
        source: 'json',
        codec: requestCodec,
        strictCodec: {
          ...requestCodec,
          create: () => glossaryReplaceRequestSchema.strict()
        }
      }],
      result: documentCodec
    }
  }
}, z)
