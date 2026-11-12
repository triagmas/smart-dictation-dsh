import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictationRecorder } from '../src/recorder'

interface FakeTrack { stopped: boolean; stop(): void }
interface FakeStream { tracks: FakeTrack[]; getTracks(): FakeTrack[] }

function fakeStream(): FakeStream {
  const track: FakeTrack = { stopped: false, stop() { this.stopped = true } }
  return { tracks: [track], getTracks() { return this.tracks } }
}

class FakeContext {
  static instances: FakeContext[] = []
  state = 'running'
  closed = false
  decode = vi.fn(async () => ({ numberOfChannels: 1, length: 1, sampleRate: 16_000, getChannelData: () => new Float32Array(1) }))
  constructor() { FakeContext.instances.push(this) }
  async resume(): Promise<void> {}
  createMediaStreamSource() { return { connect() {} } }
  createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData() {} } }
  async decodeAudioData(): Promise<unknown> { return await this.decode() }
  async close(): Promise<void> { this.state = 'closed'; this.closed = true }
}

class FakeRecorder {
  static failStop = false
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | undefined
  onstop: (() => void) | undefined
  onerror: (() => void) | undefined
  constructor(public stream: FakeStream) {}
  static isTypeSupported(): boolean { return true }
  start(): void {
    this.state = 'recording'
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2])]) })
  }
  stop(): void {
    if (FakeRecorder.failStop) throw new Error('device disappeared')
    this.state = 'inactive'
    this.onstop?.()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeContext.instances = []
  FakeRecorder.failStop = false
})

function install(getUserMedia: () => Promise<FakeStream>): void {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('MediaRecorder', FakeRecorder)
}

describe('DictationRecorder lifecycle', () => {
  it('stops a stream granted after the user cancelled the permission prompt', async () => {
    const stream = fakeStream()
    let grant: ((value: FakeStream) => void) | undefined
    install(() => new Promise((resolve) => { grant = resolve }))
    const subject = new DictationRecorder()

    const starting = subject.start()
    await subject.dispose()
    grant?.(stream)

    await expect(starting).rejects.toThrow(/disposed/i)
    expect(stream.tracks[0]!.stopped).toBe(true)
  })

  it('releases the microphone and AudioContext when decoding fails', async () => {
    const stream = fakeStream()
    install(async () => stream)
    const subject = new DictationRecorder()
    await subject.start()
    const context = FakeContext.instances[0]!
    context.decode.mockRejectedValueOnce(new Error('bad codec'))

    await expect(subject.stop()).rejects.toThrow(/bad codec/u)
    expect(stream.tracks[0]!.stopped).toBe(true)
    expect(context.closed).toBe(true)
  })

  it('releases the microphone when MediaRecorder.stop throws synchronously', async () => {
    const stream = fakeStream()
    install(async () => stream)
    const subject = new DictationRecorder()
    await subject.start()
    FakeRecorder.failStop = true

    await expect(subject.stop()).rejects.toThrow(/device disappeared/u)
    expect(stream.tracks[0]!.stopped).toBe(true)
  })
})
