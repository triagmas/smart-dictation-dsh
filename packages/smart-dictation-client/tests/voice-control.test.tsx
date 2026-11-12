import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { VoiceControl, type VoiceControlProps } from '../src/VoiceInput'

const base: VoiceControlProps = {
  phase: 'idle',
  level: 0,
  message: '',
  onStart: vi.fn(),
  onStop: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn()
}

interface ElementLike {
  type?: unknown
  props?: Record<string, unknown> & { children?: unknown }
}

function findButtons(node: unknown, out: ElementLike[] = []): ElementLike[] {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findButtons(child, out)
    return out
  }
  const element = node as ElementLike
  if (element.type === 'button') out.push(element)
  findButtons(element.props?.children, out)
  return out
}

function control(overrides: Partial<VoiceControlProps> = {}): ElementLike {
  return VoiceControl({ ...base, ...overrides }) as ReactElement as ElementLike
}

describe('VoiceControl', () => {
  it('keeps one fixed-size control while recording', () => {
    const root = control({ phase: 'recording', level: 0.5 })
    const buttons = findButtons(root)
    expect(buttons).toHaveLength(1)
    expect(buttons[0]!.props?.['aria-label']).toBe('Остановить диктовку')
    expect((root.props?.style as { width?: number }).width).toBe(28)
    expect(buttons[0]!.props?.className).toBe('sd-voice-button')
  })

  it('does not grow while transcribing or when it fails', () => {
    const transcribing = findButtons(control({ phase: 'transcribing' }))
    expect(transcribing).toHaveLength(1)
    expect(transcribing[0]!.props?.['aria-label']).toBe('Отменить распознавание')

    const failed = findButtons(control({ phase: 'failed', message: 'Микрофон недоступен' }))
    expect(failed).toHaveLength(1)
    expect(failed[0]!.props?.['aria-label']).toBe('Повторить диктовку')
    expect(failed[0]!.props?.title).toBe('Микрофон недоступен')
  })

  it('offers insertion on the same icon for a changed draft', () => {
    const pending = findButtons(control({ phase: 'pending' }))
    expect(pending).toHaveLength(1)
    expect(pending[0]!.props?.['aria-label']).toBe('Вставить распознанный текст')
  })
})
