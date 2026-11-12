import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bench = process.env.SMART_DICTATION_BENCH
const modelDir = join(
  bench ?? '',
  '.hf-cache/hub/models--istupakov--gigaam-v3-onnx/snapshots/322c3b29492673eb7d0b434bfa9dfb8653e34d02'
)
const canRun = Boolean(
  bench &&
  existsSync(join(bench, 'data/audio/n01.wav')) &&
  existsSync(join(modelDir, 'v3_e2e_ctc.int8.onnx')) &&
  existsSync(join(packageRoot, 'assets/gigaam_v3.onnx'))
)

describe.skipIf(!canRun)('GigaAM v3 end-to-end on ONNX Runtime Node', () => {
  it('matches the Python reference 5/5 and stays within the latency/RAM budget', () => {
    const output = execFileSync(process.execPath, ['scripts/spike-gigaam.mjs'], {
      cwd: packageRoot,
      env: { ...process.env, SMART_DICTATION_BENCH: bench },
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000
    })
    const result = JSON.parse(output) as {
      ok: boolean
      p50: number
      rss_mb: number
      install_mb: number
      cases: Array<{ id: string; match: boolean }>
    }

    expect(result.cases).toHaveLength(5)
    expect(result.cases.every((item) => item.match)).toBe(true)
    expect(result.p50).toBeLessThanOrEqual(0.35)
    expect(result.rss_mb).toBeLessThanOrEqual(700)
    expect(result.install_mb).toBeLessThanOrEqual(500)
    expect(result.ok).toBe(true)
  }, 120_000)
})
