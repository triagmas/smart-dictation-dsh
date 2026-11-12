import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type { GlossaryDocument } from '@smart-dictation/core'
import { GlossaryStore } from './glossary-store'
import type { GlossaryReplaceRequest } from './glossary-schema'

export interface GlossaryRemoteConfig {
  glossaryRoot: string
}

/**
 * Host Remote for the durable glossary. The Service owns the store; the
 * returned document always carries the revision the Host committed.
 */
export class GlossaryRemote extends TypertRemoteService {
  static inject = ['typert']
  static Config = z.object({
    glossaryRoot: z.string().min(1).required()
  })

  private readonly store: GlossaryStore

  constructor(ctx: Context, config: GlossaryRemoteConfig) {
    super(ctx, 'glossary', { namespace: 'glossary' })
    this.store = new GlossaryStore({ root: config.glossaryRoot })
  }

  @Remote
  async read(): Promise<GlossaryDocument> {
    return await this.store.read()
  }

  @Remote
  async replace(request: GlossaryReplaceRequest): Promise<GlossaryDocument> {
    return await this.store.replace(request.document, request.expectedRevision)
  }
}

export function applyGlossaryRemote(ctx: Context, config: GlossaryRemoteConfig) {
  return ctx.plugin(GlossaryRemote, config)
}
