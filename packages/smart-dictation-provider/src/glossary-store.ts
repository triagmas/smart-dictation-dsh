import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { GlossaryDocument } from '@smart-dictation/core'
import { parseGlossaryDocument } from './glossary-schema'
import { seedGlossaryDocument } from './seed-glossary'

export const GLOSSARY_FILE = 'glossary.json'
export const GLOSSARY_BACKUP = 'glossary.bak.json'

export class GlossaryConflictError extends Error {
  readonly code = 'conflict'

  constructor(
    readonly expected: number,
    readonly actual: number
  ) {
    super(`glossary revision conflict: expected ${expected}, actual ${actual}`)
    this.name = 'GlossaryConflictError'
  }
}

export class GlossaryCorruptError extends Error {
  readonly code = 'corrupt'

  constructor(
    readonly file: string,
    readonly quarantined?: string,
    options?: ErrorOptions
  ) {
    super(quarantined
      ? `glossary is corrupt; moved to ${quarantined}`
      : 'glossary is corrupt', options)
    this.name = 'GlossaryCorruptError'
  }
}

export class GlossaryValidationError extends Error {
  readonly code = 'invalid'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GlossaryValidationError'
  }
}

export interface GlossaryStoreOptions {
  root: string
  now?: () => Date
  /** Test seam for atomic replacement failures. */
  rename?: (from: string, to: string) => Promise<void>
}

export class GlossaryStore {
  private readonly root: string
  private readonly file: string
  private readonly backup: string
  private readonly now: () => Date
  private readonly replaceFile: (from: string, to: string) => Promise<void>
  private tail: Promise<unknown> = Promise.resolve()

  constructor(options: GlossaryStoreOptions) {
    if (!isAbsolute(options.root)) throw new Error(`glossary root must be absolute: ${options.root}`)
    this.root = resolve(options.root)
    this.file = join(this.root, GLOSSARY_FILE)
    this.backup = join(this.root, GLOSSARY_BACKUP)
    this.now = options.now ?? (() => new Date())
    this.replaceFile = options.rename ?? rename
  }

  async read(): Promise<GlossaryDocument> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if (isMissing(error)) return seedGlossaryDocument()
      throw error
    }
    try {
      return parseGlossaryDocument(JSON.parse(text))
    } catch (error) {
      if (error instanceof GlossaryCorruptError) throw error
      const quarantined = await this.quarantine()
      throw new GlossaryCorruptError(this.file, quarantined, { cause: error })
    }
  }

  replace(document: GlossaryDocument, expectedRevision: number): Promise<GlossaryDocument> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return Promise.reject(new GlossaryValidationError('expectedRevision must be a non-negative integer'))
    }
    const job = this.tail.then(async () => {
      const current = await this.read()
      if (current.revision !== expectedRevision) {
        throw new GlossaryConflictError(expectedRevision, current.revision)
      }
      const next = parseGlossaryDocument({
        version: 1,
        revision: expectedRevision + 1,
        entries: document.entries
      })
      await this.write(next)
      return next
    })
    this.tail = job.then(() => undefined, () => undefined)
    return job
  }

  /** Restore a valid backup after corruption. The restored revision is advanced. */
  repair(): Promise<GlossaryDocument> {
    const job = this.tail.then(async () => {
      // read() may already have quarantined the corrupt file in an earlier
      // call. In that case the current file is missing but the backup is the
      // only valid copy, so never mistake absence for a fresh seed.
      let present = true
      try {
        await access(this.file, constants.F_OK)
      } catch (error) {
        if (!isMissing(error)) throw error
        present = false
      }
      if (present) {
        try {
          return await this.read()
        } catch (error) {
          if (!(error instanceof GlossaryCorruptError)) throw error
        }
      }
      let text: string
      try {
        text = await readFile(this.backup, 'utf8')
      } catch (error) {
        if (isMissing(error)) throw new GlossaryCorruptError(this.file)
        throw error
      }
      let backup: GlossaryDocument
      try {
        backup = parseGlossaryDocument(JSON.parse(text))
      } catch (error) {
        throw new GlossaryValidationError('glossary backup is invalid', { cause: error })
      }
      const restored: GlossaryDocument = { ...backup, revision: backup.revision + 1 }
      await this.write(restored)
      return restored
    })
    this.tail = job.then(() => undefined, () => undefined)
    return job
  }

  private async write(document: GlossaryDocument): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await this.existingBackup()
    const temporary = join(this.root, `.${GLOSSARY_FILE}.${process.pid}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await this.replaceFile(temporary, this.file)
      await this.syncDirectory()
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async existingBackup(): Promise<void> {
    try {
      await access(this.file, constants.F_OK)
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    await copyFile(this.file, this.backup)
  }

  private async syncDirectory(): Promise<void> {
    try {
      const handle = await open(this.root, 'r')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch {
      // Directory fsync is not supported on every platform; the file itself is synced.
    }
  }

  private async quarantine(): Promise<string | undefined> {
    const stamp = this.now().toISOString().replace(/[:.]/gu, '-')
    const target = join(this.root, `glossary.corrupt-${stamp}.json`)
    try {
      await this.replaceFile(this.file, target)
      return target
    } catch {
      return undefined
    }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
