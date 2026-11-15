import { useEffect, useMemo, useRef, useState } from 'react'
import { validateGlossaryDocument, type GlossaryEntry } from '@smart-dictation/core'
import type { GlossarySnapshot } from './glossary'

export const LEARNING_ENABLED_KEY = 'dsh.smart-dictation.learning.v1'

export type ModelPhase =
  | 'unprepared'
  | 'checking'
  | 'downloading'
  | 'loading'
  | 'waking'
  | 'cancelling'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'standby'

export interface ModelStatus {
  readonly phase: ModelPhase
  readonly message?: string
  readonly resource?: string
  readonly completedBytes?: number
  readonly totalBytes?: number
}

export interface SettingsActions {
  glossary: {
    current: GlossarySnapshot
    subscribe(listener: () => void): () => void
    replaceEntries(entries: readonly GlossaryEntry[]): Promise<unknown>
    updateEntries?(mutator: (entries: readonly GlossaryEntry[]) => readonly GlossaryEntry[]): Promise<unknown>
  }
  /** Re-read the canonical Host glossary after a transport failure. */
  reloadGlossary?(): Promise<unknown>
  modelStatus?(): Promise<ModelStatus | undefined>
  prepareModel?(): Promise<void>
}

type Notice = { readonly text: string; readonly kind: 'ok' | 'error' | 'info' }

function phaseView(model: ModelStatus | undefined): {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'info'
  detail: string
} {
  if (!model) return { label: 'Не проверена', tone: 'warn', detail: 'Состояние модели пока неизвестно.' }
  switch (model.phase) {
    case 'ready':
      return { label: 'Готова', tone: 'ok', detail: 'Модель загружена и работает без сети.' }
    case 'downloading': {
      const done = model.completedBytes ?? 0
      const total = model.totalBytes
      const percent = total !== undefined && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : undefined
      return {
        label: percent === undefined ? 'Загрузка' : `Загрузка ${percent}%`,
        tone: 'info',
        detail: percent === undefined || total === undefined ? 'Скачиваю модель с сервера.' : `${formatBytes(done)} из ${formatBytes(total)}.`
      }
    }
    case 'checking':
      return { label: 'Проверка', tone: 'info', detail: 'Проверяю файлы модели.' }
    case 'loading':
      return { label: 'Загрузка', tone: 'info', detail: 'Загружаю модель в память.' }
    case 'waking':
      return { label: 'Запуск', tone: 'info', detail: 'Готовлю распознавание.' }
    case 'cancelling':
      return { label: 'Отмена', tone: 'info', detail: 'Останавливаю подготовку.' }
    case 'failed':
      return { label: 'Ошибка', tone: 'bad', detail: model.message ?? 'Не удалось подготовить модель.' }
    case 'cancelled':
      return { label: 'Отменена', tone: 'warn', detail: 'Подготовка была отменена.' }
    case 'standby':
      return { label: 'Ожидание', tone: 'warn', detail: 'Модель будет подготовлена при первом запуске.' }
    case 'unprepared':
      return { label: 'Не подготовлена', tone: 'warn', detail: 'Скачайте модель один раз — дальше сеть не нужна.' }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} МБ`
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

function useSettingsStyle() {
  useEffect(() => {
    const id = 'dsh-smart-dictation-settings-css'
    if (typeof document === 'undefined' || document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = SETTINGS_CSS
    document.head.appendChild(style)
  }, [])
}

/** Settings page and bundle page: model preparation, durable glossary and learning. */
export function Settings({ glossary, reloadGlossary, modelStatus, prepareModel }: SettingsActions) {
  const [snapshot, setSnapshot] = useState(glossary.current)
  const [model, setModel] = useState<ModelStatus | undefined>()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [modelBusy, setModelBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [learning, setLearning] = useState(() => {
    try { return globalThis.localStorage?.getItem(LEARNING_ENABLED_KEY) !== 'false' } catch { return true }
  })
  const file = useRef<HTMLInputElement>(null)

  useSettingsStyle()

  useEffect(() => {
    setSnapshot(glossary.current)
    return glossary.subscribe(() => setSnapshot(glossary.current))
  }, [glossary])

  useEffect(() => {
    if (!modelStatus) return
    let alive = true
    void modelStatus()
      .then((next) => { if (alive) setModel(next) })
      .catch(() => { /* the model card keeps its unknown state */ })
    return () => { alive = false }
  }, [modelStatus])

  const entries = snapshot.document.entries
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru')
    if (!needle) return entries
    return entries.filter((entry) =>
      entry.canonical.toLocaleLowerCase('ru').includes(needle)
      || entry.variants.some((variant) => variant.toLocaleLowerCase('ru').includes(needle))
    )
  }, [entries, query])

  const phase = phaseView(model)
  const preparing = modelBusy || (model !== undefined && ['checking', 'downloading', 'loading', 'waking', 'cancelling'].includes(model.phase))
  const writable = snapshot.writable && snapshot.origin === 'host'

  async function waitForModel(): Promise<void> {
    if (!modelStatus) return
    const deadline = Date.now() + 15 * 60 * 1000
    while (Date.now() < deadline) {
      const next = await modelStatus()
      if (next) {
        setModel(next)
        if (next.phase === 'ready') return
        if (next.phase === 'failed') throw new Error(next.message ?? 'Не удалось подготовить модель.')
        if (next.phase === 'cancelled') throw new Error('Подготовка модели отменена.')
      }
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
    throw new Error('Подготовка занимает слишком много времени. Проверьте состояние модели позже.')
  }

  const prepare = async () => {
    if (!prepareModel) return
    setModelBusy(true)
    setNotice({ text: 'Готовлю модель. Это может занять несколько минут.', kind: 'info' })
    try {
      await prepareModel()
      await waitForModel()
      setNotice({ text: 'Модель готова к работе.', kind: 'ok' })
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Не удалось подготовить модель.', kind: 'error' })
    } finally {
      setModelBusy(false)
    }
  }

  const reload = async () => {
    if (!reloadGlossary) return
    setBusy(true)
    try {
      await reloadGlossary()
      setNotice({ text: 'Словарь обновлён с Host.', kind: 'ok' })
    } catch {
      setNotice({ text: 'Host всё ещё недоступен. Попробуйте ещё раз.', kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (entry: GlossaryEntry) => {
    setBusy(true)
    try {
      const removeEntry = (items: readonly GlossaryEntry[]) => items.filter((item) => item.id !== entry.id)
      if (glossary.updateEntries) await glossary.updateEntries(removeEntry)
      else await glossary.replaceEntries(removeEntry(snapshot.document.entries))
      setNotice({ text: `Удалено: ${entry.canonical}`, kind: 'ok' })
    } catch {
      setNotice({ text: 'Не удалось удалить термин. Словарь доступен только для чтения.', kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const importFile = async (selected: File) => {
    setBusy(true)
    try {
      const parsed = JSON.parse(await selected.text()) as { entries?: GlossaryEntry[] }
      if (!Array.isArray(parsed.entries)) throw new Error('shape')
      const errors = validateGlossaryDocument({ version: 1, revision: 0, entries: parsed.entries })
      if (errors.length > 0) throw new Error('invalid')
      await glossary.replaceEntries(parsed.entries)
      setNotice({ text: `Импортировано терминов: ${parsed.entries.length}`, kind: 'ok' })
    } catch {
      setNotice({ text: 'Не удалось прочитать файл. Нужен JSON, экспортированный из Smart Dictation.', kind: 'error' })
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(snapshot.document, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'smart-dictation-glossary.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const setLearningEnabled = (enabled: boolean) => {
    setLearning(enabled)
    try { globalThis.localStorage?.setItem(LEARNING_ENABLED_KEY, String(enabled)) } catch { /* cache only */ }
  }

  return (
    <section className="sd-root" aria-labelledby="sd-title">
      <header className="sd-head">
        <div>
          <h1 className="sd-title" id="sd-title">Smart Dictation</h1>
          <p className="sd-sub">
            Локальная диктовка для DSH: русская речь с английскими терминами, знаки препинания
            и личный словарь. Аудио и модель не покидают эту машину.
          </p>
        </div>
        <span className="sd-badge sd-badge-ok"><span className="sd-dot" aria-hidden="true" />Локальная модель</span>
      </header>

      <div className="sd-stats">
        <div className="sd-card sd-stat">
          <span className="sd-stat-label">Провайдер</span>
          <strong className="sd-stat-value">GigaAM v3</strong>
          <span className="sd-stat-detail">INT8 · офлайн</span>
        </div>
        <div className="sd-card sd-stat">
          <span className="sd-stat-label">Модель</span>
          <strong className="sd-stat-value">{phase.label}</strong>
          <span className="sd-stat-detail">{model?.phase === 'downloading' ? phase.detail : '~225 МБ на диске'}</span>
        </div>
        <div className="sd-card sd-stat">
          <span className="sd-stat-label">Словарь</span>
          <strong className="sd-stat-value">{entries.length}</strong>
          <span className="sd-stat-detail">{writable ? 'синхронизирован' : 'локальная копия'}</span>
        </div>
      </div>

      <section className="sd-card" aria-labelledby="sd-model-title">
        <div className="sd-card-head">
          <div>
            <h2 className="sd-card-title" id="sd-model-title">Модель</h2>
            <p className="sd-card-sub">Распознавание работает на этом компьютере. При первом запуске модель скачивается один раз.</p>
          </div>
          <span className={`sd-badge sd-badge-${phase.tone}`}>{phase.label}</span>
        </div>

        <div className="sd-model-row">
          <div className="sd-model-copy">
            <code className="sd-path">~/.dsh/speech-to-text/gigaam-v3</code>
            <p className="sd-help">{phase.detail}</p>
            {model?.phase === 'downloading' && (
              <div
                className="sd-progress"
                role="progressbar"
                aria-label="Загрузка модели"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={model.totalBytes ? Math.round(((model.completedBytes ?? 0) / model.totalBytes) * 100) : undefined}
              >
                <span style={{ width: `${model.totalBytes ? Math.min(100, Math.round(((model.completedBytes ?? 0) / model.totalBytes) * 100)) : 8}%` }} />
              </div>
            )}
          </div>
          {prepareModel && (
            <button type="button" className="sd-button sd-button-primary" disabled={preparing} onClick={() => void prepare()}>
              {preparing ? 'Подготовка…' : model?.phase === 'ready' ? 'Проверить модель' : 'Подготовить модель'}
            </button>
          )}
        </div>
      </section>

      <section className="sd-card" aria-labelledby="sd-glossary-title">
        <div className="sd-card-head">
          <div>
            <h2 className="sd-card-title" id="sd-glossary-title">Словарь</h2>
            <p className="sd-card-sub">Термины, которые диктовка узнаёт и исправляет. Хранятся в вашем профиле DSH.</p>
          </div>
          <div className="sd-actions">
            <button type="button" className="sd-button" disabled={busy} onClick={exportFile}>Экспорт</button>
            <button type="button" className="sd-button" disabled={busy || !writable} onClick={() => file.current?.click()}>Импорт</button>
            <input
              ref={file}
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => {
                const selected = event.target.files?.[0]
                if (selected) void importFile(selected)
              }}
            />
          </div>
        </div>

        {!writable && (
          <div className="sd-notice sd-notice-warn" role="status">
            <div>
              <strong>Словарь доступен только для чтения</strong>
              <span>Хост DSH не отвечает. Показаны последние сохранённые термины; изменения временно недоступны.</span>
            </div>
            {reloadGlossary && <button type="button" className="sd-button sd-button-small" disabled={busy} onClick={() => void reload()}>Повторить</button>}
          </div>
        )}

        <div className="sd-toolbar">
          <input
            className="sd-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти термин или вариант"
            aria-label="Поиск по словарю"
          />
          <span className="sd-count">{query ? `${filtered.length} из ${entries.length}` : `${entries.length} терминов`}</span>
        </div>

        <div className="sd-table-wrap">
          <table className="sd-table">
            <thead>
              <tr>
                <th scope="col">Термин</th>
                <th scope="col">Варианты распознавания</th>
                <th scope="col"><span className="sd-sr-only">Действия</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td><span className="sd-term">{entry.canonical}</span></td>
                  <td className="sd-variants" title={entry.variants.join(', ')}>
                    {entry.variants.length > 0 ? entry.variants.slice(0, 3).join(' · ') : '—'}
                    {entry.variants.length > 3 && <span className="sd-more"> +{entry.variants.length - 3}</span>}
                  </td>
                  <td className="sd-row-actions">
                    <button
                      type="button"
                      className="sd-icon-button"
                      disabled={busy || !writable}
                      title={writable ? `Удалить ${entry.canonical}` : 'Словарь доступен только для чтения'}
                      aria-label={`Удалить ${entry.canonical}`}
                      onClick={() => void remove(entry)}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="sd-empty">
                    {entries.length === 0 ? 'Словарь пока пуст. Термины появятся после подтверждённых исправлений.' : 'Ничего не найдено.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sd-card" aria-labelledby="sd-learning-title">
        <div className="sd-card-head">
          <div>
            <h2 className="sd-card-title" id="sd-learning-title">Обучение</h2>
            <p className="sd-card-sub">Новые термины добавляются только после вашего подтверждения.</p>
          </div>
        </div>
        <label className="sd-switch-row">
          <span className="sd-switch-copy">
            <strong>Учиться на подтверждённых правках</strong>
            <span>После отправки DSH может предложить запомнить исправленный термин.</span>
          </span>
          <input
            className="sd-switch-input"
            type="checkbox"
            role="switch"
            checked={learning}
            onChange={(event) => setLearningEnabled(event.target.checked)}
          />
          <span className="sd-switch-track" aria-hidden="true" />
        </label>
      </section>

      {notice && (
        <div className={`sd-notice sd-notice-${notice.kind}`} role="status" aria-live="polite">
          <span>{notice.text}</span>
        </div>
      )}
    </section>
  )
}

const SETTINGS_CSS = `
.sd-root{--sd-radius:12px;--sd-gap:14px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;width:100%;max-width:1000px;margin:0 auto;padding:8px 4px 32px;box-sizing:border-box;min-width:0}
.sd-root *{box-sizing:border-box}
.sd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:0 0 14px;flex-wrap:wrap}
.sd-title{margin:0 0 4px;font-size:18px;font-weight:650;letter-spacing:-.01em}
.sd-sub{margin:0;color:var(--dsw-alias-label-secondary);font-size:12.5px;max-width:720px}
.sd-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;white-space:nowrap}
.sd-badge-ok{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent)}
.sd-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent)}
.sd-badge-bad{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
.sd-badge-info{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}
.sd-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.sd-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sd-gap);margin-bottom:var(--sd-gap)}
.sd-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:var(--sd-radius);padding:14px 16px;min-width:0}
.sd-stat{display:grid;gap:2px;align-content:start;padding:12px 14px}
.sd-stat-label{color:var(--dsw-alias-label-secondary);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.sd-stat-value{font-size:20px;font-weight:650;letter-spacing:-.02em;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-stat-detail{color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.sd-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:12px}
.sd-card-title{margin:0 0 3px;font-size:14px;font-weight:650}
.sd-card-sub{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;max-width:680px}
.sd-actions{display:flex;gap:8px;flex-wrap:wrap}
.sd-button{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 11px;font:inherit;font-size:12px;font-weight:550;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;transition:background .12s ease,border-color .12s ease}
.sd-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.sd-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.sd-button:disabled{opacity:.45;cursor:default}
.sd-button-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.sd-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-foreground)}
.sd-button-small{min-height:26px;padding:3px 9px;font-size:11.5px}
.sd-model-row{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.sd-model-copy{display:grid;gap:7px;min-width:0;flex:1 1 320px}
.sd-path{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:2px 6px;color:var(--dsw-alias-label-secondary)}
.sd-help{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}
.sd-progress{height:5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;max-width:420px}
.sd-progress span{display:block;height:100%;background:var(--dsw-alias-brand-primary);border-radius:inherit;transition:width .2s ease}
.sd-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;flex-wrap:wrap}
.sd-input{flex:1 1 240px;min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;padding:7px 9px;min-height:32px}
.sd-input:focus{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);outline-offset:0;border-color:var(--dsw-alias-brand-primary)}
.sd-count{color:var(--dsw-alias-label-tertiary);font-size:11.5px;white-space:nowrap}
.sd-table-wrap{max-height:360px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}
.sd-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
.sd-table th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;text-align:left;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap}
.sd-table td{padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:middle}
.sd-table tr:last-child td{border-bottom:0}
.sd-table tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}
.sd-term{font-weight:550;overflow-wrap:anywhere}
.sd-variants{color:var(--dsw-alias-label-secondary);max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-more{color:var(--dsw-alias-label-tertiary)}
.sd-row-actions{width:38px;text-align:right}
.sd-icon-button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:6px;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.sd-icon-button:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2)}
.sd-icon-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sd-icon-button:disabled{opacity:.35;cursor:default}
.sd-empty{color:var(--dsw-alias-label-tertiary);text-align:center;padding:20px 10px!important;white-space:normal}
.sd-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:9px 11px;margin:0 0 12px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.sd-notice strong{display:block;color:var(--dsw-alias-label-primary);font-weight:600}
.sd-notice span{display:block}
.sd-notice-ok{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent)}
.sd-notice-error{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
.sd-notice-info{color:var(--dsw-alias-label-secondary)}
.sd-switch-row{display:flex;align-items:center;justify-content:space-between;gap:18px;cursor:pointer;position:relative}
.sd-switch-copy{display:grid;gap:2px;min-width:0}
.sd-switch-copy strong{font-size:12.5px;font-weight:600}
.sd-switch-copy span{color:var(--dsw-alias-label-secondary);font-size:12px}
.sd-switch-input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
.sd-switch-track{flex:0 0 auto;width:34px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);position:relative;transition:background .15s ease,border-color .15s ease}
.sd-switch-track::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform .15s ease}
.sd-switch-input:checked+.sd-switch-track{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.sd-switch-input:checked+.sd-switch-track::after{transform:translateX(14px);background:var(--dsw-alias-label-primary-foreground)}
.sd-switch-input:focus-visible+.sd-switch-track{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.sd-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:760px){.sd-stats{grid-template-columns:1fr}.sd-head{align-items:stretch}.sd-model-row{align-items:stretch}.sd-model-row .sd-button{width:100%}.sd-table-wrap{max-height:300px}}
@media (prefers-reduced-motion:reduce){.sd-button,.sd-progress span,.sd-switch-track,.sd-switch-track::after{transition:none}}
`
