import { fileURLToPath } from 'node:url'
import type { ModelAsset } from './model-manager'

export const GIGAAM_REVISION = '322c3b29492673eb7d0b434bfa9dfb8653e34d02'

function urls(path: string): Record<string, string> {
  const suffix = `istupakov/gigaam-v3-onnx/resolve/${GIGAAM_REVISION}/${path}`
  return {
    'https://huggingface.co': `https://huggingface.co/${suffix}`,
    'https://hf-mirror.com': `https://hf-mirror.com/${suffix}`
  }
}

export const GIGAAM_ASSETS: readonly ModelAsset[] = [
  {
    filename: 'v3_e2e_ctc.int8.onnx',
    bytes: 224_893_347,
    sha256: '2e3fcb7a7b66030336fd10c2fcfb033bd1dc7e1bf238fe5cfd83b1d0cfc9d28e',
    urls: urls('v3_e2e_ctc.int8.onnx')
  },
  {
    filename: 'v3_e2e_ctc_vocab.txt',
    bytes: 2_007,
    sha256: '142de7570b3de5b3035ce111a89c228e80e6085273731d944093ddf24fa539cd',
    urls: urls('v3_e2e_ctc_vocab.txt')
  }
]

export const GIGAAM_PREPROCESSOR_PATH = fileURLToPath(
  new URL('../assets/gigaam_v3.onnx', import.meta.url)
)
