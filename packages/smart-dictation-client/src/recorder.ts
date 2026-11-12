/** Browser capture and deterministic WAV conversion for the speech Host. */

export const TARGET_SAMPLE_RATE = 16_000

export interface RecorderOptions {
  deviceId?: string
  mimeType?: string
}

export interface Recording {
  start(onError?: (error: Error) => void): Promise<void>
  stop(maxDurationSeconds?: number): Promise<Uint8Array>
  dispose(): Promise<void>
  readonly level: number
}

/** Convert mono float samples in [-1, 1] to a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  writeAscii(bytes, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(bytes, 8, 'WAVE')
  writeAscii(bytes, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(bytes, 36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(44 + i * 2, Math.max(-0x8000, Math.min(0x7fff, Math.round(value * 0x8000))), true)
  }
  return bytes
}

/** Linear resampling is sufficient for speech and keeps unit tests deterministic. */
export function resampleTo16k(input: Float32Array, sourceRate: number): Float32Array {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) throw new Error('sourceRate must be positive')
  if (sourceRate === TARGET_SAMPLE_RATE) return input.slice()
  if (input.length === 0) return new Float32Array()
  const length = Math.max(1, Math.round((input.length * TARGET_SAMPLE_RATE) / sourceRate))
  const output = new Float32Array(length)
  const ratio = sourceRate / TARGET_SAMPLE_RATE
  for (let i = 0; i < length; i++) {
    const position = i * ratio
    const left = Math.min(input.length - 1, Math.floor(position))
    const right = Math.min(input.length - 1, left + 1)
    const fraction = position - left
    output[i] = (input[left] ?? 0) * (1 - fraction) + (input[right] ?? 0) * fraction
  }
  return output
}

export function base64Wav(wav: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < wav.length; i += chunk) {
    binary += String.fromCharCode(...wav.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** MediaRecorder capture; the final bytes are always 16 kHz mono PCM16 WAV. */
export class DictationRecorder implements Recording {
  private readonly options: RecorderOptions
  private stream: MediaStream | undefined
  private recorder: MediaRecorder | undefined
  private context: AudioContext | undefined
  private analyser: AnalyserNode | undefined
  private chunks: BlobPart[] = []
  private durationTimer: ReturnType<typeof setTimeout> | undefined
  private rejectStop: ((error: Error) => void) | undefined
  private onError: ((error: Error) => void) | undefined
  private disposed = false

  constructor(options: RecorderOptions = {}) {
    this.options = options
  }

  get level(): number {
    if (!this.analyser) return 0
    const buffer = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(buffer)
    let sum = 0
    for (const value of buffer) sum += value * value
    return Math.min(1, Math.sqrt(sum / buffer.length) * 4)
  }

  async start(onError?: (error: Error) => void): Promise<void> {
    if (this.disposed) throw new Error('recording was disposed')
    if (this.recorder) throw new Error('recording already started')
    this.onError = onError
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) throw new Error('microphone capture is not available')
    const stream = await media.getUserMedia({
      audio: this.options.deviceId ? { deviceId: { exact: this.options.deviceId } } : true
    })
    // A cancel can arrive while the browser permission prompt is open. Do not
    // leave the freshly granted stream live after the UI has moved to idle.
    if (this.disposed) {
      for (const track of stream.getTracks()) track.stop()
      throw new Error('recording was disposed')
    }
    this.stream = stream
    try {
      const context = new AudioContext()
      this.context = context
      await context.resume()
      if (this.disposed) throw new Error('recording was disposed')
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      this.analyser = analyser
      const mimeType = this.pickMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      this.recorder = recorder
      this.chunks = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data)
      }
      recorder.onerror = () => {
        const error = new Error('media recorder failed')
        this.onError?.(error)
        this.rejectStop?.(error)
        void this.dispose()
      }
      recorder.start(250)
    } catch (error) {
      await this.cleanup()
      throw error
    }
  }

  async stop(maxDurationSeconds?: number): Promise<Uint8Array> {
    const recorder = this.recorder
    const context = this.context
    if (!recorder || !context) throw new Error('recording is not started')
    if (maxDurationSeconds !== undefined) {
      clearTimeout(this.durationTimer)
      this.durationTimer = undefined
    }
    try {
      const stopped = new Promise<void>((resolve, reject) => {
        this.rejectStop = reject
        recorder.onstop = () => resolve()
      })
      // stop() can throw synchronously when the device disappeared; the
      // finally block still releases the microphone and the AudioContext.
      recorder.stop()
      await stopped
      const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' })
      const decoded = await context.decodeAudioData(await blob.arrayBuffer())
      const mono = toMono(decoded)
      const resampled = resampleTo16k(mono, decoded.sampleRate)
      return encodeWav(resampled)
    } finally {
      this.chunks = []
      this.rejectStop = undefined
      await this.cleanup()
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    clearTimeout(this.durationTimer)
    this.durationTimer = undefined
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop() } catch { /* already stopped */ }
    }
    this.recorder = undefined
    this.chunks = []
    this.rejectStop?.(new Error('recording disposed'))
    this.rejectStop = undefined
    await this.cleanup()
  }

  private pickMimeType(): string | undefined {
    if (this.options.mimeType) return this.options.mimeType
    for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) return candidate
    }
    return undefined
  }

  private async cleanup(): Promise<void> {
    this.analyser = undefined
    this.recorder = undefined
    this.chunks = []
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = undefined
    const context = this.context
    this.context = undefined
    if (context && context.state !== 'closed') await context.close().catch(() => undefined)
  }
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice()
  const output = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i++) output[i] = (output[i] ?? 0) + (data[i] ?? 0) / buffer.numberOfChannels
  }
  return output
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i)
}
