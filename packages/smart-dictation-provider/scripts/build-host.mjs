import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(resolve(root, 'lib'), { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: {
    index: 'src/index.ts',
    'remote-client': 'src/remote-client.ts',
    'typert-host': 'src/typert-host.ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outdir: 'lib',
  external: ['onnxruntime-node', '@deepseek-ai/*'],
  logLevel: 'silent'
})
