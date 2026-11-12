import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { validateGlossaryDocument, type GlossaryEntry } from '@smart-dictation/core'
import type { GlossarySnapshot } from './glossary'

export const LEARNING_ENABLED_KEY = 'dsh.smart-dictation.learning.v1'

export interface SettingsActions {
  glossary: {
    current: GlossarySnapshot
    subscribe(listener: () => void): () => void
    replaceEntries(entries: readonly GlossaryEntry[]): Promise<unknown>
    updateEntries?(mutator: (entries: readonly GlossaryEntry[]) => readonly GlossaryEntry[]): Promise<unknown>
  }
  openBundle?(): void
  prepareModel?(): Promise<void>
}

const card: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '14px 16px',
  border: '1px solid rgba(127, 127, 127, 0.28)',
  borderRadius: 10
}

const heading: CSSProperties = { margin: 0, fontSize: 15 }
const hint: CSSProperties = { margin: 0, opacity: 0.72, lineHeight: 1.45 }

/** Settings page and bundle page: model preparation, durable glossary and learning. */
export function Settings({ glossary, openBundle, prepareModel }: SettingsActions) {
  const [snapshot, setSnapshot] = useState(glossary.current)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [learning, setLearning] = useState(() => {
    try { return globalThis.localStorage?.getItem(LEARNING_ENABLED_KEY) !== 'false' } catch { return true }
  })
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSnapshot(glossary.current)
    return glossary.subscribe(() => setSnapshot(glossary.current))
  }, [glossary])

  const remove = async (entry: GlossaryEntry) => {
    setBusy(true)
    try {
      const removeEntry = (entries: readonly GlossaryEntry[]) => entries.filter((item) => item.id !== entry.id)
      if (glossary.updateEntries) await glossary.updateEntries(removeEntry)
      else await glossary.replaceEntries(removeEntry(snapshot.document.entries))
      setMessage(`Удалено: ${entry.canonical}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить словарь.')
    } finally {
      setBusy(false)
    }
  }

  const importFile = async (selected: File) => {
    setBusy(true)
    try {
      const parsed = JSON.parse(await selected.text()) as { entries?: GlossaryEntry[] }
      if (!Array.isArray(parsed.entries)) throw new Error('В файле нет массива entries.')
      const errors = validateGlossaryDocument({ version: 1, revision: 0, entries: parsed.entries })
      if (errors.length > 0) throw new Error(`Файл словаря некорректен: ${errors[0]}`)
      await glossary.replaceEntries(parsed.entries)
      setMessage(`Импортировано терминов: ${parsed.entries.length}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Некорректный файл словаря.')
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
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section style={{ display: 'grid', gap: 16, fontSize: 13 }}>
      <header style={{ display: 'grid', gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Smart Dictation</h2>
        <p style={hint}>
          Локальная диктовка для DSH Web: русская речь с английскими терминами, знаки препинания
          и личный словарь. Аудио и модель не покидают эту машину.
        </p>
      </header>

      <div style={card}>
        <h3 style={heading}>Модель</h3>
        <p style={hint}>
          Первый запуск скачивает около 225 МБ в <code>~/.dsh/speech-to-text/gigaam-v3</code>.
          После подготовки сеть не нужна.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {prepareModel && <button type="button" disabled={busy} onClick={() => {
            setBusy(true)
            setMessage('Готовлю модель…')
            void prepareModel().then(() => setMessage('Модель готова.')).catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : 'Не удалось подготовить модель.')
            }).finally(() => setBusy(false))
          }}>Подготовить модель</button>}
          {openBundle && <button type="button" onClick={openBundle}>Страница плагина</button>}
        </div>
      </div>

      <div style={card}>
        <h3 style={heading}>Словарь</h3>
        <p style={hint}>
          Словарь хранится на Host: {snapshot.origin} · {snapshot.document.entries.length} терминов.
          {!snapshot.writable && <strong style={{ color: '#b45309' }}> Только чтение: Host недоступен.</strong>}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={busy || !snapshot.writable} onClick={exportFile}>Экспорт JSON</button>
          <button type="button" disabled={busy || !snapshot.writable} onClick={() => file.current?.click()}>Импорт JSON</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={(event) => {
            const selected = event.target.files?.[0]
            if (selected) void importFile(selected)
          }} />
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {snapshot.document.entries.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.canonical}</strong>
              {entry.variants.length > 0 && <span style={{ opacity: 0.7 }}> ← {entry.variants.join(', ')}</span>}
              <button type="button" style={{ marginLeft: 8 }} disabled={busy || !snapshot.writable} onClick={() => void remove(entry)}>Удалить</button>
            </li>
          ))}
          {snapshot.document.entries.length === 0 && <li style={{ opacity: 0.7 }}>Словарь пока пуст.</li>}
        </ul>
      </div>

      <div style={card}>
        <h3 style={heading}>Обучение</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={learning} onChange={(event) => {
            const enabled = event.target.checked
            setLearning(enabled)
            try { globalThis.localStorage?.setItem(LEARNING_ENABLED_KEY, String(enabled)) } catch { /* cache only */ }
          }} />
          Учиться на подтверждённых правках
        </label>
        <p style={hint}>
          После отправки DSH может предложить запомнить исправленный термин. Новые записи
          появляются в словаре только после подтверждения.
        </p>
      </div>

      {snapshot.error && <p role="status" style={{ color: '#b45309', margin: 0 }}>{snapshot.error}</p>}
      {message && <p role="status" style={{ margin: 0 }}>{message}</p>}
    </section>
  )
}
