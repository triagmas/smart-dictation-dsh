import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GIGAAM_PREPROCESSOR_PATH } from '../src/gigaam-assets'
import { GigaAmRecognizer } from '../src/recognizer'

const bench = process.env.SMART_DICTATION_BENCH
const modelDir = join(
  bench ?? '',
  '.hf-cache/hub/models--istupakov--gigaam-v3-onnx/snapshots/322c3b29492673eb7d0b434bfa9dfb8653e34d02'
)
const canRun = Boolean(
  bench &&
  existsSync(join(bench, 'data/audio/n01.wav')) &&
  existsSync(join(modelDir, 'v3_e2e_ctc.int8.onnx')) &&
  existsSync(GIGAAM_PREPROCESSOR_PATH)
)

function normalize(text: string): string {
  return text.toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ').trim()
}

describe.skipIf(!canRun)('GigaAM recognizer integration', () => {
  it('transcribes n01 to the Python reference text', async () => {
    const reference = JSON.parse(await readFile(join(bench!, 'out/raw/gigaam-v3-e2e-ctc.json'), 'utf8'))
      .passes[0]
      .find((item: { id: string }) => item.id === 'n01')
      .text as string
    const recognizer = await GigaAmRecognizer.create({
      preprocessor: GIGAAM_PREPROCESSOR_PATH,
      acoustic: join(modelDir, 'v3_e2e_ctc.int8.onnx'),
      vocab: join(modelDir, 'v3_e2e_ctc_vocab.txt')
    }, { threads: 4 })
    try {
      const text = await recognizer.transcribe(new Uint8Array(await readFile(join(bench!, 'data/audio/n01.wav'))))
      expect(normalize(text)).toBe(normalize(reference))
    } finally {
      await recognizer.close()
    }
  }, 120_000)
})
