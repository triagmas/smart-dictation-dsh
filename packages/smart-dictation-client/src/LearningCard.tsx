import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LearningCardSnapshot } from './learning'

export interface LearningCardProps {
  card: LearningCardSnapshot | undefined
  onAccept(): void
  onReject(): void
}

const CARD_CSS = `
.sd-learn-card{box-sizing:border-box;padding:12px;background:var(--dsw-alias-bg-layer-3,#2b2b30);color:var(--dsw-alias-label-primary,#f2f2f2);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:var(--dsw-radius-md,10px);box-shadow:var(--dsw-elevation-panel,0 12px 32px rgba(0,0,0,.4));font-size:13px;line-height:1.45}
.sd-learn-card__title{margin:0 0 4px;font-weight:500;overflow-wrap:anywhere}
.sd-learn-card__hint{margin:0 0 10px;color:var(--dsw-alias-label-tertiary,#a1a1aa);font-size:12px}
.sd-learn-card__error{margin:0 0 8px;color:var(--dsw-alias-state-error-primary,#ff6b6b)}
.sd-learn-card__actions{display:flex;gap:8px;justify-content:flex-end}
.sd-learn-card__button{box-sizing:border-box;height:28px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.18));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-4,#3a3a40);color:var(--dsw-alias-label-primary,#f2f2f2);font:inherit;cursor:pointer}
.sd-learn-card__button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18))}
.sd-learn-card__button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4a90e2);outline-offset:1px}
.sd-learn-card__button:disabled{opacity:.5;cursor:default}
`

/** Confirmation only; never sends the message or edits the draft by itself. */
export function LearningCard({ card, onAccept, onReject }: LearningCardProps) {
  const ref = useRef<HTMLElement>(null)
  const acceptRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<{ bottom: number; right: number }>()
  const open = card !== undefined

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    acceptRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [open])

  useLayoutEffect(() => {
    if (card === undefined || typeof window === 'undefined') return
    const update = () => {
      const composer = ref.current?.closest('[data-composer-card]')
      if (!(composer instanceof HTMLElement)) return
      const rect = composer.getBoundingClientRect()
      setAnchor({
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
        right: Math.max(8, window.innerWidth - rect.right + 8)
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [card])

  if (card === undefined) return null
  const terms = card.candidates.map((candidate) => `«${candidate.canonical}»`).join(', ')
  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-labelledby="sd-learn-title"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onReject()
        }
      }}
      className="sd-learn-card"
      style={{
        position: anchor ? 'fixed' : 'absolute',
        right: anchor?.right ?? 0,
        bottom: anchor?.bottom ?? 'calc(100% + 8px)',
        zIndex: 30,
        width: 'min(280px, calc(100vw - 32px))', maxHeight: '40vh', overflowY: 'auto'
      }}
    >
      <style>{CARD_CSS}</style>
      <p className="sd-learn-card__title" id="sd-learn-title">Запомнить {terms}?</p>
      <p className="sd-learn-card__hint">Термин был исправлен в тексте. Добавить его в словарь?</p>
      {card.error && <p role="alert" className="sd-learn-card__error">{card.error}</p>}
      <div className="sd-learn-card__actions">
        <button type="button" className="sd-learn-card__button" disabled={card.status === 'saving'} onClick={onReject}>Нет</button>
        <button ref={acceptRef} type="button" className="sd-learn-card__button" disabled={card.status === 'saving'} onClick={onAccept}>Да</button>
      </div>
    </aside>
  )
}
