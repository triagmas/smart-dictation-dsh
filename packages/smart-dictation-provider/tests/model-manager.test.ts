import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelManager, type ModelAsset, type ModelSnapshot } from '../src/model-manager'

const modelBytes = Buffer.from('tiny-model')
const vocabBytes = Buffer.from('a 0\n<blk> 1\n')
const modelSha = createHash('sha256').update(modelBytes).digest('hex')
const vocabSha = createHash('sha256').update(vocabBytes).digest('hex')

let server: Server | undefined
let root: string | undefined
let requests = 0

async function startServer(delayMs = 0): Promise<string> {
  server = createServer((request, response) => {
    requests += 1
    const body = request.url === '/model.onnx' ? modelBytes : request.url === '/vocab.txt' ? vocabBytes : undefined
    if (!body) {
      response.writeHead(404).end()
      return
    }
    const send = () => {
      response.writeHead(200, { 'content-length': String(body.length) })
      response.end(body)
    }
    if (delayMs > 0) setTimeout(send, delayMs)
    else send()
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no server address')
  return `http://127.0.0.1:${address.port}`
}

function assets(base: string, overrideModelSha = modelSha): ModelAsset[] {
  return [
    {
      filename: 'model.onnx', bytes: modelBytes.length, sha256: overrideModelSha,
      urls: { test: `${base}/model.onnx`, mirror: `${base}/model.onnx` }
    },
    {
      filename: 'vocab.txt', bytes: vocabBytes.length, sha256: vocabSha,
      urls: { test: `${base}/vocab.txt`, mirror: `${base}/vocab.txt` }
    }
  ]
}

async function manager(base: string, overrideModelSha?: string): Promise<ModelManager> {
  root = await mkdtemp(join(tmpdir(), 'smart-dictation-model-'))
  return new ModelManager({
    root,
    assets: assets(base, overrideModelSha),
    defaultSource: 'test'
  })
}

afterEach(async () => {
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve())
  server = undefined
  requests = 0
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('ModelManager', () => {
  it('downloads, verifies and atomically renames assets', async () => {
    const base = await startServer()
    const subject = await manager(base)
    const states: ModelSnapshot[] = []
    subject.subscribe((snapshot) => states.push(snapshot))

    await subject.prepare({ downloadSource: 'test' })

    expect(subject.snapshot().state).toBe('ready')
    expect(await readFile(join(root!, 'model.onnx'))).toEqual(modelBytes)
    expect(existsSync(join(root!, 'model.onnx.part'))).toBe(false)
    expect(states.some((item) => item.state === 'checking' && item.step === 'verify')).toBe(true)
    expect(states.some((item) => item.state === 'downloading')).toBe(true)
    expect(states.at(-1)?.state).toBe('ready')
  })

  it('is idempotent and does not download a second time', async () => {
    const base = await startServer()
    const subject = await manager(base)
    await subject.prepare({ downloadSource: 'test' })
    const count = requests
    await subject.prepare({ downloadSource: 'test' })
    expect(requests).toBe(count)
  })

  it('classifies an integrity error, removes .part and leaves no final file', async () => {
    const base = await startServer()
    const subject = await manager(base, '0'.repeat(64))

    await expect(subject.prepare({ downloadSource: 'test' })).rejects.toThrow(/integrity/i)
    expect(subject.snapshot().state).toBe('failed')
    expect(subject.snapshot().error?.kind).toBe('integrity')
    expect(existsSync(join(root!, 'model.onnx.part'))).toBe(false)
    expect(existsSync(join(root!, 'model.onnx'))).toBe(false)
  })

  it('cancels an in-flight download and removes .part', async () => {
    const base = await startServer(300)
    const subject = await manager(base)
    const preparing = subject.prepare({ downloadSource: 'test' })
    while (subject.snapshot().state !== 'downloading') await new Promise((resolve) => setTimeout(resolve, 10))

    await subject.cancel()
    await expect(preparing).rejects.toThrow(/cancel/i)
    expect(subject.snapshot().state).toBe('cancelled')
    expect(existsSync(join(root!, 'model.onnx.part'))).toBe(false)
  })

  it('rejects changing the source while a download is active', async () => {
    const base = await startServer(300)
    const subject = await manager(base)
    const preparing = subject.prepare({ downloadSource: 'test' })
    while (subject.snapshot().state !== 'downloading') await new Promise((resolve) => setTimeout(resolve, 10))

    await expect(subject.prepare({ downloadSource: 'mirror' })).rejects.toThrow(/source/i)
    await subject.cancel()
    await preparing.catch(() => undefined)
    expect(subject.snapshot().state).toBe('cancelled')
  })

  it('rejects an unknown source without downloading', async () => {
    const base = await startServer()
    const subject = await manager(base)
    await expect(subject.prepare({ downloadSource: 'missing' })).rejects.toThrow(/source/i)
    expect(requests).toBe(0)
    expect(subject.snapshot().state).toBe('failed')
  })
})

describe('ModelManager recovery', () => {
  it('replaces a corrupt existing file after an integrity mismatch', async () => {
    const base = await startServer()
    const subject = await manager(base)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root!, 'model.onnx'), 'corrupt-existing-file')

    await subject.prepare({ downloadSource: 'test' })

    expect(subject.snapshot().state).toBe('ready')
    expect(await readFile(join(root!, 'model.onnx'))).toEqual(modelBytes)
    expect(requests).toBeGreaterThan(0)
  })
})
