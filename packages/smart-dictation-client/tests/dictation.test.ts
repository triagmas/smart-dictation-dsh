import { describe, expect, it, vi } from 'vitest'
import { DictationController, type InsertionActions, type SpeechTranscriber } from '../src/dictation'

const wav = new Uint8Array([1, 2, 3])

function actions(insertResult = true) {
  const calls: string[] = []
  const insert: InsertionActions = {
    captureInsertion: () => {
      calls.push('capture')
      return { at: 7 }
    },
    insertText: (text, span) => {
      calls.push(`insert:${text}:${String((span as { at: number }).at)}`)
      return insertResult
    }
  }
  return { calls, insert }
}

describe('DictationController', () => {
  it('captures the insertion point before inserting the transcript', async () => {
    const { calls, insert } = actions()
    const transcribe = vi.fn(async () => ({ ok: true as const, value: { text: 'привет' } }))
    const subject = new DictationController({ insert, transcribe: transcribe as SpeechTranscriber })
    subject.begin()
    await expect(subject.insert(wav)).resolves.toMatchObject({ status: 'inserted', text: 'привет' })
    expect(calls).toEqual(['capture', 'insert:привет:7'])
    expect(transcribe).toHaveBeenCalledWith({ audioBase64: 'AQID', language: 'ru' }, undefined)
  })

  it('keeps text pending when the draft conflicts, then retries into a fresh span', async () => {
    const { calls, insert } = actions(false)
    const subject = new DictationController({
      insert,
      transcribe: async () => ({ ok: true, value: { text: 'привет' } })
    })
    subject.begin()
    await expect(subject.insert(wav)).resolves.toMatchObject({ status: 'pending', text: 'привет' })
    expect(subject.pending).toBe('привет')
    insert.insertText = ((text: string, span: unknown) => {
      calls.push(`insert:${text}:${String((span as { at: number }).at)}`)
      return true
    }) as InsertionActions['insertText']
    expect(subject.retry()).toMatchObject({ status: 'inserted', text: 'привет' })
    expect(subject.pending).toBe('')
    expect(calls.at(-1)).toBe('insert:привет:7')
  })

  it('cancel drops pending text and never inserts', async () => {
    const { calls, insert } = actions()
    const transcribe = vi.fn(async () => ({ ok: true as const, value: { text: 'привет' } }))
    const subject = new DictationController({ insert, transcribe: transcribe as SpeechTranscriber })
    subject.begin()
    subject.cancel()
    await expect(subject.insert(wav)).resolves.toEqual({ status: 'cancelled' })
    expect(calls).toEqual(['capture'])
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('surfaces host transcription failures without touching the draft', async () => {
    const { calls, insert } = actions()
    const subject = new DictationController({
      insert,
      transcribe: async () => ({ ok: false, error: { message: 'model missing' } })
    })
    subject.begin()
    await expect(subject.insert(wav)).resolves.toEqual({ status: 'failed', message: 'model missing' })
    expect(calls).toEqual(['capture'])
  })
})
