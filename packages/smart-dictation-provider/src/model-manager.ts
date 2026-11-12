import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'

export interface ModelAsset {
  filename: string
  bytes: number
  sha256: string
  urls: Record<string, string>
}

export type ModelState =
  | 'unprepared'
  | 'checking'
  | 'downloading'
  | 'loading'
  | 'ready'
  | 'failed'
  | 'cancelled'

export type ModelErrorKind = 'network' | 'integrity' | 'storage' | 'source' | 'cancelled'

export interface ModelError {
  kind: ModelErrorKind
  message: string
}

export interface ModelProgress {
  filename: string
  downloadedBytes: number
  totalBytes: number
  percent: number
}

export interface ModelSnapshot {
  state: ModelState
  step?: 'verify' | 'download'
  source?: string
  progress?: ModelProgress
  error?: ModelError
}

export interface ModelManagerOptions {
  root: string
  assets: readonly ModelAsset[]
  defaultSource: string
}

export interface PrepareOptions {
  downloadSource?: string
}

interface ActivePreparation {
  source: string
  controller: AbortController
  cancelRequested: boolean
  promise: Promise<void>
}

export class ModelPreparationError extends Error {
  readonly kind: ModelErrorKind

  constructor(kind: ModelErrorKind, message: string) {
    super(message)
    this.name = 'ModelPreparationError'
    this.kind = kind
  }
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
 * Downloads model assets into a private data directory, verifies SHA-256 and
 * atomically publishes each file. A failed download never becomes a final file.
 */
export class ModelManager {
  readonly root: string
  readonly assets: readonly ModelAsset[]

  private readonly defaultSource: string
  private readonly listeners = new Set<(snapshot: ModelSnapshot) => void>()
  private current: ModelSnapshot = { state: 'unprepared' }
  private active: ActivePreparation | undefined

  constructor(options: ModelManagerOptions) {
    if (options.assets.length === 0) throw new Error('at least one model asset is required')
    this.root = resolve(options.root)
    this.assets = options.assets
    this.defaultSource = options.defaultSource
    for (const asset of this.assets) {
      if (!asset.filename || asset.filename.includes('/') || asset.filename.includes('\\') || asset.filename === '..') {
        throw new Error('asset filename must be a plain file name')
      }
      if (!Number.isInteger(asset.bytes) || asset.bytes <= 0) throw new Error('asset bytes must be positive')
      if (!/^[a-f0-9]{64}$/u.test(asset.sha256)) throw new Error('asset sha256 must be a lowercase hex digest')
      if (!asset.urls[this.defaultSource]) throw new Error(`default source is missing for ${asset.filename}`)
    }
  }

  snapshot(): ModelSnapshot {
    const snapshot: ModelSnapshot = { ...this.current }
    if (this.current.progress) snapshot.progress = { ...this.current.progress }
    return snapshot
  }

  subscribe(listener: (snapshot: ModelSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  pathOf(filename: string): string {
    return join(this.root, filename)
  }

  sources(): string[] {
    return Object.keys(this.assets[0]?.urls ?? {})
  }

  prepare(options: PrepareOptions = {}): Promise<void> {
    if (this.active) {
      if (options.downloadSource && options.downloadSource !== this.active.source) {
        return Promise.reject(new ModelPreparationError('source', 'download source cannot change while preparation is active'))
      }
      return this.active.promise
    }
    if (this.current.state === 'ready' && !options.downloadSource) return Promise.resolve()

    const source = options.downloadSource ?? this.defaultSource
    if (!this.assets.every((asset) => asset.urls[source])) {
      this.fail('source', 'unknown download source')
      return Promise.reject(new ModelPreparationError('source', 'unknown download source'))
    }

    const controller = new AbortController()
    const active = {
      source,
      controller,
      cancelRequested: false,
      promise: Promise.resolve()
    } satisfies ActivePreparation & { promise: Promise<void> }
    this.active = active

    active.promise = this.run(active).finally(() => {
      if (this.active === active) this.active = undefined
    })
    return active.promise
  }

  async cancel(): Promise<void> {
    const active = this.active
    if (!active) {
      if (this.current.state === 'checking' || this.current.state === 'downloading' || this.current.state === 'loading') {
        this.setSnapshot({ state: 'cancelled' })
      }
      return
    }
    active.cancelRequested = true
    active.controller.abort()
    await active.promise.catch(() => undefined)
    if (this.current.state !== 'failed') this.setSnapshot({ state: 'cancelled' })
  }

  private async run(active: ActivePreparation): Promise<void> {
    this.setSnapshot({ state: 'checking', step: 'verify', source: active.source })

    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 })

      for (const asset of this.assets) {
        this.throwIfCancelled(active)
        const target = this.pathOf(asset.filename)

        if (await this.fileExists(target)) {
          this.setSnapshot({ state: 'checking', step: 'verify', source: active.source })
          const actual = await hashFile(target)
          if (actual !== asset.sha256) {
            // A truncated or tampered file would otherwise fail every retry
            // without ever reaching the network. Keep it for diagnosis and
            // download a fresh copy.
            const rejected = `${target}.bad-${Date.now()}`
            try {
              await rename(target, rejected)
            } catch {
              await rm(target, { force: true })
            }
            await this.download(active, asset)
          }
          continue
        }

        await this.download(active, asset)
      }

      this.throwIfCancelled(active)
      this.setSnapshot({ state: 'loading', source: active.source })
      this.throwIfCancelled(active)
      this.setSnapshot({ state: 'ready', source: active.source })
    } catch (error) {
      if (active.cancelRequested || isAbortError(error)) {
        this.setSnapshot({ state: 'cancelled', source: active.source })
        throw new ModelPreparationError('cancelled', 'preparation cancelled')
      }
      if (error instanceof ModelPreparationError) {
        this.fail(error.kind, error.message)
        throw error
      }
      const kind: ModelErrorKind = isStorageError(error) ? 'storage' : 'network'
      const message = kind === 'storage' ? 'could not write model files' : 'model download failed'
      this.fail(kind, message)
      throw new ModelPreparationError(kind, message)
    }
  }

  private async download(active: ActivePreparation, asset: ModelAsset): Promise<void> {
    const url = asset.urls[active.source]
    if (!url) throw new ModelPreparationError('source', 'unknown download source')

    const target = this.pathOf(asset.filename)
    const part = `${target}.part`
    let committed = false
    try {
      await writeFile(part, new Uint8Array(), { mode: 0o600 })

      this.setSnapshot({
        state: 'downloading',
        step: 'download',
        source: active.source,
        progress: { filename: asset.filename, downloadedBytes: 0, totalBytes: asset.bytes, percent: 0 }
      })

      let response: Response
      try {
        response = await fetch(url, { signal: active.controller.signal, redirect: 'follow' })
      } catch (error) {
        if (active.cancelRequested || isAbortError(error)) throw error
        throw new ModelPreparationError('network', 'model download failed')
      }
      if (!response.ok || !response.body) {
        throw new ModelPreparationError('network', `model download failed (${response.status})`)
      }

      const handle = await open(part, 'w', 0o600)
      let downloaded = 0
      try {
        const stream = Readable.fromWeb(response.body as never)
        for await (const chunk of stream) {
          this.throwIfCancelled(active)
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
          if (downloaded + buffer.length > asset.bytes) {
            throw new ModelPreparationError('integrity', `model is larger than expected for ${asset.filename}`)
          }
          downloaded += buffer.length
          await handle.write(buffer)
          this.setSnapshot({
            state: 'downloading',
            step: 'download',
            source: active.source,
            progress: {
              filename: asset.filename,
              downloadedBytes: downloaded,
              totalBytes: asset.bytes,
              percent: Math.min(100, (downloaded / asset.bytes) * 100)
            }
          })
        }
        await handle.sync()
      } finally {
        await handle.close()
      }

      if (downloaded !== asset.bytes) {
        throw new ModelPreparationError('integrity', `integrity check failed for ${asset.filename}`)
      }

      const actual = await hashFile(part)
      if (actual !== asset.sha256) {
        throw new ModelPreparationError('integrity', `integrity check failed for ${asset.filename}`)
      }

      await rename(part, target)
      committed = true
    } finally {
      if (!committed) await rm(part, { force: true }).catch(() => {})
    }
  }

  private throwIfCancelled(active: ActivePreparation): void {
    if (active.cancelRequested) throw new ModelPreparationError('cancelled', 'preparation cancelled')
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile()
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  private fail(kind: ModelErrorKind, message: string): void {
    this.setSnapshot({ state: 'failed', error: { kind, message } })
  }

  private setSnapshot(snapshot: ModelSnapshot): void {
    this.current = snapshot
    for (const listener of this.listeners) listener(this.snapshot())
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function isStorageError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    ['EACCES', 'EIO', 'ENOSPC', 'EROFS', 'EPERM'].includes(String(error.code))
}
