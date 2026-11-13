#!/usr/bin/env node
/** Offline checks for the tarballs produced by scripts/package-release.mjs. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(resolve(fileURLToPath(import.meta.url), '..'), '..')
const artifacts = resolve(root, '.release/artifacts')
const release = JSON.parse(await readFile(resolve(artifacts, 'release.json'), 'utf8'))
const errors = []

for (const item of release) {
  const path = resolve(artifacts, item.tarball)
  const bytes = await readFile(path)
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (hash !== item.sha256) errors.push(`${item.tarball}: sha256 mismatch`)
  if ((await stat(path)).size !== item.bytes) errors.push(`${item.tarball}: size mismatch`)
  const listing = execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).split('\n')
  if (item.package === '@triagmas/dsh-smart-dictation-provider' && !listing.includes('package/assets/gigaam_v3.onnx')) {
    errors.push('provider tarball is missing the 44 KB preprocessor asset')
  }
  if (item.package === '@triagmas/dsh-smart-dictation-client' && !listing.includes('package/lib/client.js')) {
    errors.push('client tarball is missing the browser bundle')
  }
  if (item.package === '@triagmas/dsh-smart-dictation') {
    for (const required of ['package/cordis.patch.yml', 'package/icon.png', 'package/locale/en.json', 'package/locale/ru.json', 'package/docs/DETAIL.md']) {
      if (!listing.includes(required)) errors.push(`bundle tarball is missing ${required}`)
    }
    const manifest = JSON.parse(execFileSync('tar', ['-xOzf', path, 'package/package.json'], { encoding: 'utf8' }))
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (String(spec).includes('workspace:')) errors.push(`bundle dependency ${name} still uses workspace protocol`)
    }
    if (manifest.private) errors.push('bundle manifest is still private')
    if (!manifest.dsh?.bundle?.patch) errors.push('bundle manifest has no dsh.bundle.patch')
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`release verified: ${release.length} tarballs, hashes and required assets present`)
