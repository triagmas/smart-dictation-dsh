import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'lib/client.js')

await mkdir(dirname(outfile), { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['src/client.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  outfile,
  external: ['react', 'react/jsx-runtime'],
  logLevel: 'silent'
})
const body = await readFile(outfile, 'utf8')
const wrapped = `window.__ModuleLoader__.load({
  id: "@triagmas/dsh-smart-dictation-client",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`
await writeFile(outfile, wrapped)
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outfile: resolve(root, 'lib/index.js'),
  logLevel: 'silent'
})
