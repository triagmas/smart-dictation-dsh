import { describe, expect, it } from 'vitest'
import { processTranscript } from '../src/text'

describe('processTranscript cleanup', () => {
  it('fixes spaces and punctuation', () => {
    const result = processTranscript('Задеплой Docker , пожалуйста .', [])
    expect(result.clean).toBe('Задеплой Docker, пожалуйста.')
  })

  it('adds spaces after sentence punctuation without splitting numbers', () => {
    const result = processTranscript('Версия 3.14.Раз, два.Т.е. тест.', [])
    expect(result.clean).toBe('Версия 3.14. Раз, два. Т.е. тест.')
  })

  it('removes fillers with surrounding commas', () => {
    expect(processTranscript('Ну, э-э, надо посмотреть.', []).clean)
      .toBe('надо посмотреть.')
  })

  it('collapses repeated words case-insensitively', () => {
    expect(processTranscript('Я я думаю', []).clean).toBe('Я думаю')
  })

  it('keeps raw text and reports changes', () => {
    const result = processTranscript('Ну,  я я думаю .', [])
    expect(result.raw).toBe('Ну,  я я думаю .')
    expect(result.clean).toBe('я думаю.')
    expect(result.changes.length).toBeGreaterThan(0)
  })
})

describe('contextual fillers', () => {
  it('keeps "значит" when it is the predicate', () => {
    expect(processTranscript('это значит, что мы идём', []).clean)
      .toBe('это значит, что мы идём')
  })

  it('removes "значит" as a parenthetical', () => {
    expect(processTranscript('Значит, идём домой', []).clean).toBe('идём домой')
    expect(processTranscript('это, значит, важно', []).clean).toBe('это, важно')
  })
})
