import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GIGAAM_ASSETS, GIGAAM_PREPROCESSOR_PATH } from './gigaam-assets'
import { ModelManager } from './model-manager'
import { GigaAmProvider } from './provider'
import { applyGlossaryRemote } from './glossary-remote'

export { GIGAAM_ASSETS, GIGAAM_PREPROCESSOR_PATH, GIGAAM_REVISION } from './gigaam-assets'
export { ModelManager, ModelPreparationError, type ModelAsset, type ModelSnapshot } from './model-manager'
export { GigaAmProvider, type GigaAmProviderOptions, type ProviderModelSource } from './provider'
export { GigaAmRecognizer, type GigaAmPaths, type GigaAmRecognizerOptions } from './recognizer'
export { GlossaryStore, GlossaryConflictError, GlossaryCorruptError, GlossaryValidationError } from './glossary-store'
export { GlossaryRemote, applyGlossaryRemote, type GlossaryRemoteConfig } from './glossary-remote'
export { decodeWav, type DecodedWav } from './wav'

export interface Config {
  dataRoot: string
  glossaryRoot: string
  threads: number
}

export const Config = z.object({
  dataRoot: z.string().min(1).required(),
  glossaryRoot: z.string().min(1).required(),
  threads: z.natural().min(1).max(32).default(4)
})

export const name = 'smart-dictation'
export const inject = ['speechToText']

/**
 * Register the local GigaAM provider. Activation never downloads or loads a model;
 * the Settings UI starts preparation explicitly.
 */
export function apply(ctx: Context, config: Config): void {
  if (!isAbsolute(config.dataRoot)) throw new Error(`Smart Dictation data root must be absolute: ${config.dataRoot}`)
  if (!isAbsolute(config.glossaryRoot)) throw new Error(`Smart Dictation glossary root must be absolute: ${config.glossaryRoot}`)

  const model = new ModelManager({
    root: config.dataRoot,
    assets: GIGAAM_ASSETS,
    defaultSource: 'https://huggingface.co'
  })
  const provider = new GigaAmProvider({
    model,
    preprocessorPath: GIGAAM_PREPROCESSOR_PATH,
    threads: config.threads
  })

  applyGlossaryRemote(ctx, { glossaryRoot: config.glossaryRoot })

  ctx.effect(() => {
    const unregister = ctx.speechToText.register(provider)
    return async () => {
      await unregister()
      await provider.close()
    }
  })
}
