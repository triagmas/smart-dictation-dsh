import { useCallback, useEffect, useRef, useState } from 'react'
import type { GlossaryEntry } from '@smart-dictation/core'
import { DictationController, type DictationOutcome, type InsertionActions, type SpeechTranscriber } from './dictation'
import type { Recording } from './recorder'
import type { DraftStateLike, LearningController } from './learning'
import { LearningCard } from './LearningCard'

export interface VoiceInputActions {
  createRecording(): Recording
  transcribe: SpeechTranscriber
  glossary?: () => readonly GlossaryEntry[]
  glossarySource?: () => string
}

export type UseInput = (selector: (state: DraftStateLike) => DraftStateLike) => DraftStateLike

export interface VoiceInputProps extends VoiceInputActions {
  sessionId: string
  inputActions: InsertionActions
  locked?: boolean
  input?: DraftStateLike
  learning?: LearningController
}

type Phase = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'pending' | 'failed'

const MAX_SECONDS = 120
const CONTROL_SIZE = 28

const CONTROL_CSS = `
.sd-voice-button{box-sizing:border-box;width:${CONTROL_SIZE}px;height:${CONTROL_SIZE}px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8d98);display:grid;place-items:center;cursor:pointer;position:relative;flex:none;transition:background-color .12s ease,color .12s ease}
.sd-voice-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-secondary,#555)}
.sd-voice-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4a90e2);outline-offset:1px}
.sd-voice-button[data-phase="recording"]{color:#e5484d;background:rgba(229,72,77,.12)}
.sd-voice-button[data-phase="failed"]{color:#e5484d}
.sd-voice-button[data-phase="pending"]{color:#d97706}
.sd-voice-button:disabled{cursor:default;opacity:.45}
@keyframes smart-dictation-spin{to{transform:rotate(360deg)}}
.sd-voice-spinner{transform-origin:14px 14px;animation:smart-dictation-spin .9s linear infinite}
@media (prefers-reduced-motion:reduce){.sd-voice-spinner{animation-duration:2.4s}}
`

const SR_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0
} as const

export interface VoiceControlProps {
  phase: Phase
  level: number
  message: string
  locked?: boolean
  onStart(): void
  onStop(): void
  onCancel(): void
  onRetry(): void
}

/**
 * One fixed-size button for every dictation state. It never grows into a bar:
 * the glyph, ring and a tiny status dot carry the state instead.
 */
export function VoiceControl({
  phase, level, message, locked = false, onStart, onStop, onCancel, onRetry
}: VoiceControlProps) {
  const recording = phase === 'recording'
  const busy = phase === 'requesting' || phase === 'transcribing'
  const label = locked
    ? 'Диктовка недоступна'
    : phase === 'idle'
      ? 'Диктовать'
      : recording
        ? 'Остановить диктовку'
        : phase === 'requesting'
          ? 'Отменить запрос микрофона'
          : phase === 'transcribing'
            ? 'Отменить распознавание'
            : phase === 'pending'
              ? 'Вставить распознанный текст'
              : 'Повторить диктовку'
  const hint = message || label
  const status = recording
    ? 'Идёт запись'
    : phase === 'transcribing'
      ? 'Распознавание'
      : phase === 'failed'
        ? message || 'Ошибка диктовки'
        : phase === 'pending'
          ? 'Черновик изменился'
          : ''
  const color = recording || phase === 'failed' ? '#e5484d' : phase === 'pending' ? '#d97706' : 'currentColor'

  const activate = () => {
    if (locked) return
    if (phase === 'idle' || phase === 'failed') onStart()
    else if (recording) onStop()
    else if (phase === 'pending') onRetry()
    else onCancel()
  }

  const circumference = 2 * Math.PI * 12.5
  const filled = Math.max(0, Math.min(1, level)) * circumference

  return (
    <span style={{
      position: 'relative', display: 'inline-flex', width: CONTROL_SIZE, height: CONTROL_SIZE,
      alignItems: 'center', justifyContent: 'center', flex: 'none'
    }}>
      <style>{CONTROL_CSS}</style>
      <button
        type="button"
        className="sd-voice-button"
        data-phase={phase}
        aria-label={label}
        title={hint}
        disabled={locked}
        onClick={activate}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          {recording ? (
            <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" />
          ) : (
            <>
              <rect x="5.75" y="1.75" width="4.5" height="7.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
        </svg>
        {recording && (
          <svg viewBox="0 0 28 28" aria-hidden="true" style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            transform: 'rotate(-90deg)', pointerEvents: 'none'
          }}>
            <circle cx="14" cy="14" r="12.5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"
              strokeDasharray={`${filled} ${circumference}`} />
          </svg>
        )}
        {busy && (
          <svg viewBox="0 0 28 28" aria-hidden="true" style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none'
          }}>
            <circle className="sd-voice-spinner" cx="14" cy="14" r="12.5" fill="none" stroke={color}
              strokeWidth="2" strokeLinecap="round" strokeDasharray="18 60" />
          </svg>
        )}
        {(phase === 'failed' || phase === 'pending') && (
          <span aria-hidden="true" style={{
            position: 'absolute', right: 0, bottom: 0, width: 6, height: 6, borderRadius: '50%',
            background: color, boxShadow: '0 0 0 1.5px var(--dsw-alias-bg-primary,#fff)'
          }} />
        )}
      </button>
      <span role="status" aria-live="polite" style={SR_ONLY}>{status}</span>
    </span>
  )
}

/** The slot passes its standard `useInput` hook; tests may mount without it. */
export function VoiceInput(props: VoiceInputProps & { useInput?: UseInput }) {
  if (props.useInput === undefined) return <VoiceInputBody {...props} />
  return <VoiceInputWithInput {...props} useInput={props.useInput} />
}

function VoiceInputWithInput(props: VoiceInputProps & { useInput: UseInput }) {
  const input = props.useInput((state) => state)
  return <VoiceInputBody {...props} input={input} />
}

/** Toolbar activity: record, stop, retry; insertion is always explicit. */
function VoiceInputBody({
  sessionId, inputActions, locked, createRecording, transcribe, glossary, glossarySource, input, learning
}: VoiceInputProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const [level, setLevel] = useState(0)
  const [card, setCard] = useState(learning?.current)
  const recording = useRef<Recording | undefined>(undefined)
  const controller = useRef<DictationController | undefined>(undefined)
  const abort = useRef<AbortController | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const meter = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const generation = useRef(0)
  const revision = useRef<number | undefined>(undefined)
  const finishRef = useRef<(() => Promise<void>) | undefined>(undefined)

  useEffect(() => {
    if (learning === undefined) return
    setCard(learning.current)
    return learning.subscribe(() => setCard(learning.current))
  }, [learning])

  useEffect(() => {
    if (input !== undefined) learning?.observe(input)
  }, [input, learning])

  const clearTimers = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    if (meter.current) clearInterval(meter.current)
    timer.current = undefined
    meter.current = undefined
  }, [])

  const remember = useCallback((outcome: DictationOutcome) => {
    if (learning === undefined || outcome.status !== 'inserted') return
    learning.recordDictation({
      raw: outcome.raw, clean: outcome.text,
      ...revision.current === undefined ? {} : { draftRev: revision.current },
      sessionId
    })
  }, [learning, sessionId])

  const cancel = useCallback(() => {
    generation.current++
    clearTimers()
    abort.current?.abort()
    controller.current?.cancel()
    const active = recording.current
    recording.current = undefined
    void active?.dispose()
    setPhase('idle')
    setMessage('')
    setLevel(0)
  }, [clearTimers])

  useEffect(() => {
    setPhase('idle')
    setMessage('')
    void recording.current?.dispose()
    recording.current = undefined
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('keydown', escape)
      generation.current++
      clearTimers()
      abort.current?.abort()
      void recording.current?.dispose()
      recording.current = undefined
    }
  }, [sessionId, cancel, clearTimers])

  const finish = useCallback(async () => {
    const active = recording.current
    const dictation = controller.current
    if (!active || !dictation || phase !== 'recording') return
    const run = generation.current
    clearTimers()
    setPhase('transcribing')
    try {
      const wav = await active.stop()
      if (run !== generation.current) return
      const outcome = await dictation.insert(wav, abort.current?.signal)
      if (run !== generation.current) return
      remember(outcome)
      if (outcome.status === 'inserted') {
        setPhase('idle')
        setMessage('')
      } else if (outcome.status === 'pending') {
        setMessage('Черновик изменился — текст сохранён.')
        setPhase('pending')
      } else if (outcome.status === 'failed') {
        setMessage(outcome.message)
        setPhase('failed')
      } else if (outcome.status === 'empty') {
        setMessage('Речь не распознана.')
        setPhase('failed')
      } else {
        setPhase('idle')
      }
    } catch (error) {
      if (run === generation.current) {
        setMessage(error instanceof Error ? error.message : 'Не удалось записать звук.')
        setPhase('failed')
      }
    } finally {
      // stop() and dispose() are idempotent; always release the stream even
      // when decoding failed or the component moved on to another run.
      await active.dispose()
      if (run === generation.current) recording.current = undefined
    }
  }, [phase, clearTimers, remember])
  finishRef.current = finish

  const start = useCallback(async () => {
    if (locked || phase === 'requesting' || phase === 'recording' || phase === 'transcribing') return
    const previous = recording.current
    recording.current = undefined
    void previous?.dispose()
    const run = ++generation.current
    const dictation = new DictationController({
      insert: inputActions,
      transcribe,
      ...glossary === undefined ? {} : { glossary },
      ...glossarySource === undefined ? {} : { glossarySource }
    })
    dictation.begin()
    revision.current = dictation.spanRevision
    const active = createRecording()
    controller.current = dictation
    recording.current = active
    abort.current = new AbortController()
    setMessage('')
    setPhase('requesting')
    try {
      await active.start((error) => {
        if (run !== generation.current) return
        setMessage(error.message)
        setPhase('failed')
      })
      if (run !== generation.current) {
        await active.dispose()
        return
      }
      setPhase('recording')
      meter.current = setInterval(() => setLevel(active.level), 120)
      // The callback captures the latest finish(), not the render that started
      // this recording, so the 120 s guard also works in long sessions.
      timer.current = setTimeout(() => { void finishRef.current?.() }, MAX_SECONDS * 1000)
    } catch (error) {
      await active.dispose()
      if (run === generation.current) {
        recording.current = undefined
        setMessage(error instanceof Error ? error.message : 'Микрофон недоступен.')
        setPhase('failed')
      }
    }
  }, [locked, phase, inputActions, transcribe, glossary, glossarySource, createRecording, finish])

  const retry = () => {
    const outcome = controller.current?.retry()
    if (outcome?.status === 'inserted') {
      remember(outcome)
      setMessage('')
      setPhase('idle')
      return
    }
    if (outcome === undefined) {
      // insertText() returns false when the draft changed or is busy sending.
      setMessage('Не удалось вставить: черновик изменён или занят отправкой. Попробуйте ещё раз.')
      setPhase('pending')
    }
  }

  return (
    <div style={{
      position: 'relative', display: 'inline-flex', alignItems: 'center',
      width: CONTROL_SIZE, height: CONTROL_SIZE, flex: 'none'
    }}>
      <VoiceControl
        phase={phase}
        level={level}
        message={message}
        locked={locked ?? false}
        onStart={() => void start()}
        onStop={() => void finish()}
        onCancel={cancel}
        onRetry={retry}
      />
      <LearningCard card={card} onAccept={() => void learning?.accept()} onReject={() => void learning?.reject()} />
    </div>
  )
}
