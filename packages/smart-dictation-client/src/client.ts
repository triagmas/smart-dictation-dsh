import type { GlossaryDocument, GlossaryEntry } from '@smart-dictation/core'
import { DictationRecorder } from './recorder'
import { VoiceInput, type VoiceInputActions } from './VoiceInput'
import { Settings, LEARNING_ENABLED_KEY } from './Settings'
import { LearningController } from './learning'
import type { SpeechTranscriber } from './dictation'
import { ClientGlossaryStore } from './glossary-store'
import { GlossaryController, browserCacheStorage } from './glossary'

/** Cordis services this client needs before it may touch `ctx.remote` or `ctx.slots`. */
export const inject = ['remote', 'slots']

interface RemoteSpeech {
  transcribe(request: { audioBase64: string; language?: string; providerId?: string }, signal?: AbortSignal): Promise<
    | { ok: true; value: { text: string } }
    | { ok: false; error: { message: string } }
  >
  prepare(providerId: string, options?: unknown): Promise<{ ok: true } | { ok: false; error: { message: string } }>
}

type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } }

interface RemoteGlossary {
  read(): Promise<RemoteResult<GlossaryDocument>>
  replace(request: { document: GlossaryDocument; expectedRevision: number }): Promise<RemoteResult<GlossaryDocument>>
}

interface ClientContext {
  remote: {
    $mount(contribution: unknown): Promise<() => Promise<void> | void>
    speech: RemoteSpeech
    glossary: RemoteGlossary
  }
  slots: {
    inject(name: string, callback: () => unknown): unknown
    register(options: {
      name: string
      key?: string
      id?: string
      order?: number
      label?: string | (() => string)
      inject: () => unknown
    }, component: unknown): unknown
  }
  effect(callback: () => () => void): unknown
  get?<T = unknown>(name: string): T | undefined
  inject(
    names: readonly string[],
    callback: (scope: ClientContext) => unknown
  ): Promise<{ dispose(): Promise<void> | void }> & { dispose(): Promise<void> | void }
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const { TYPERT_REMOTE: speechRemote } = await import('@deepseek-ai/dsh-experimental-api-speech-to-text/remote')
  const disposeSpeech = await ctx.remote.$mount(speechRemote)
  let disposeGlossary: (() => Promise<void> | void) | undefined

  try {
    const { TYPERT_REMOTE: glossaryRemote } = await import('@triagmas/dsh-smart-dictation-provider/remote')
    disposeGlossary = await ctx.remote.$mount(glossaryRemote)

    // Remote namespaces are Cordis services in their own right (`remote.glossary`
    // and `remote.speech`), so they only become reachable inside an injection
    // scope. Accessing them directly on the root context throws.
    const ui = ctx.inject(['remote.speech', 'remote.glossary'], (scope) => registerUi(scope))
    try {
      await ui
    } catch (error) {
      await ui.dispose()
      throw error
    }

    return async () => {
      try {
        await ui.dispose()
      } finally {
        await disposeGlossary?.()
        await disposeSpeech()
      }
    }
  } catch (error) {
    await disposeGlossary?.()
    await disposeSpeech()
    throw error
  }
}

async function registerUi(scope: ClientContext): Promise<void> {
  const glossary = new GlossaryController(new ClientGlossaryStore({
    remote: {
      read: async () => unwrapGlossary(await scope.remote.glossary.read()),
      replace: async (request) => unwrapGlossary(await scope.remote.glossary.replace(request))
    },
    storage: browserCacheStorage()
  }))
  await glossary.load()

  const learning = new LearningController({
    glossary,
    enabled: () => {
      try { return globalThis.localStorage?.getItem(LEARNING_ENABLED_KEY) !== 'false' } catch { return true }
    }
  })
  const recordings = new Set<DictationRecorder>()
  const actions: VoiceInputActions = {
    createRecording: () => {
      const recording = new DictationRecorder()
      recordings.add(recording)
      return recording
    },
    transcribe: async (request, signal) => await scope.remote.speech.transcribe(request, signal),
    glossary: () => glossary.entries,
    glossarySource: () => glossary.source
  }
  let navigation: { openBundle(id: string): void } | undefined
  try {
    navigation = scope.get?.('pluginNavigation') as { openBundle(id: string): void } | undefined
  } catch {
    // The Plugins panel is optional in some clients.
  }
  const settingsActions = {
    glossary,
    openBundle: navigation === undefined
      ? undefined
      : () => navigation.openBundle('@triagmas/dsh-smart-dictation'),
    prepareModel: async () => {
      const result = await scope.remote.speech.prepare('gigaam-local', undefined)
      if (!result.ok) throw new Error(result.error.message)
    }
  }

  const activityRegistration = scope.slots.inject('conversation.input.activity', () => scope.slots.register({
    name: 'conversation.input.activity',
    inject: () => ({ ...actions, learning })
  }, VoiceInput))
  const settingsSectionRegistration = scope.slots.inject('settings.section', () => scope.slots.register({
    name: 'settings.section',
    id: 'smart-dictation',
    order: 40,
    label: 'Smart Dictation',
    inject: () => settingsActions
  }, Settings))
  const settingsRegistration = scope.slots.inject('plugins.bundle.config', () => {
    try {
      return scope.slots.register({
        name: 'plugins.bundle.config',
        key: '@triagmas/dsh-smart-dictation',
        inject: () => settingsActions
      }, Settings)
    } catch (error) {
      // The Settings page is the primary entry point; a bundle-page slot that
      // appears late must not take the whole client down.
      const logger = scope.get?.('logger') as { error(error: unknown): void } | undefined
      logger?.error(error)
      return { dispose: () => {} }
    }
  })

  scope.effect(() => () => {
    disposeRegistration(settingsRegistration)
    disposeRegistration(settingsSectionRegistration)
    disposeRegistration(activityRegistration)
    for (const recording of recordings) void recording.dispose()
    recordings.clear()
  })
}

/** Typert remotes answer with a result envelope; the store works with the payload. */
function unwrapGlossary(result: RemoteResult<GlossaryDocument>): GlossaryDocument {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function disposeRegistration(value: unknown): void {
  if (typeof value === 'function') {
    ;(value as () => void)()
  } else if (typeof value === 'object' && value !== null && 'dispose' in value) {
    const dispose = (value as { dispose?: () => void }).dispose
    if (typeof dispose === 'function') dispose()
  }
}

