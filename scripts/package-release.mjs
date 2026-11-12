#!/usr/bin/env node
/**
 * Build self-contained release tarballs without publishing anything.
 *
 * The bundle is the only installable entry point. Its client/provider
 * dependencies are rewritten to the matching GitHub Release assets so a later
 * `dsh plugin add <bundle.tgz>` never needs an unpublished npm package.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.env.RELEASE_VERSION ?? '1.0.0'
const repo = process.env.RELEASE_REPO ?? 'triagmas/smart-dictation-dsh'
const tag = process.env.RELEASE_TAG ?? `v${version}`
const releaseBase = `https://github.com/${repo}/releases/download/${tag}`
const stageRoot = resolve(root, '.release/stage')
const artifactRoot = resolve(root, '.release/artifacts')
const npmCache = process.env.npm_config_cache ?? '/tmp/npm-cache-smart'

const packages = [
  {
    dir: 'packages/smart-dictation-provider',
    tarball: `smart-dictation-dsh-provider-${version}.tgz`,
    include: ['lib', 'src', 'assets', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']
  },
  {
    dir: 'packages/smart-dictation-client',
    tarball: `smart-dictation-dsh-client-${version}.tgz`,
    include: ['lib', 'src', 'README.md', 'LICENSE']
  },
  {
    dir: 'packages/smart-dictation-bundle',
    tarball: `smart-dictation-dsh-bundle-${version}.tgz`,
    include: [
      'lib', 'cordis.patch.yml', 'icon.png', 'locale', 'docs',
      'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'
    ]
  }
]

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      npm_config_cache: npmCache,
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
      npm_config_audit: 'false'
    }
  })
}

await rm(stageRoot, { recursive: true, force: true })
await rm(artifactRoot, { recursive: true, force: true })
await mkdir(stageRoot, { recursive: true })
await mkdir(artifactRoot, { recursive: true })

const built = []
for (const entry of packages) {
  const source = resolve(root, entry.dir)
  const stage = resolve(stageRoot, entry.dir.split('/').pop())
  await mkdir(stage, { recursive: true })
  for (const item of entry.include) {
    const from = resolve(source, item)
    if (!existsSync(from)) throw new Error(`missing release input: ${from}`)
    await cp(from, resolve(stage, item), { recursive: true })
  }
  const manifest = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'))
  manifest.version = version
  delete manifest.private
  delete manifest.scripts
  delete manifest.devDependencies
  if (manifest.name === '@smart-dictation/dsh-bundle') {
    manifest.dependencies['@smart-dictation/dsh-client'] =
      `${releaseBase}/smart-dictation-dsh-client-${version}.tgz`
    manifest.dependencies['@smart-dictation/dsh-provider'] =
      `${releaseBase}/smart-dictation-dsh-provider-${version}.tgz`
  }
  await writeFile(resolve(stage, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  if (!manifest.files?.some((item) => item.startsWith('lib'))) {
    throw new Error(`${manifest.name}: release manifest does not publish lib`)
  }
  const output = run('npm', ['pack', '--json', '--pack-destination', artifactRoot, '.'], stage)
  const packed = JSON.parse(output)
  const filename = packed[0]?.filename
  if (!filename) throw new Error(`${manifest.name}: npm pack returned no filename`)
  const packedPath = resolve(artifactRoot, filename)
  if (filename !== entry.tarball) throw new Error(`unexpected tarball name ${filename}, expected ${entry.tarball}`)
  const { size } = await stat(packedPath)
  built.push({
    package: manifest.name,
    version,
    tarball: filename,
    bytes: size,
    sha256: createHash('sha256').update(await readFile(packedPath)).digest('hex')
  })
  console.log(`packed ${manifest.name} -> ${filename}`)
}

await writeFile(
  resolve(artifactRoot, 'SHA256SUMS'),
  built.map((item) => `${item.sha256}  ${item.tarball}`).join('\n') + '\n'
)
await writeFile(resolve(artifactRoot, 'release.json'), JSON.stringify(built, null, 2) + '\n')
console.log(`\nArtifacts: ${artifactRoot}`)
console.log(`Bundle install: dsh plugin --profile web add ${releaseBase}/smart-dictation-dsh-bundle-${version}.tgz`)
