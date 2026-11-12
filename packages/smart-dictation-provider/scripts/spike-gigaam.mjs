import { readFile, stat, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ort from 'onnxruntime-node'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const bench = resolve(process.env.SMART_DICTATION_BENCH ?? join(here, '../../../bench'))
const modelDir = resolve(
  process.env.SMART_DICTATION_MODEL_DIR ??
    join(bench, '.hf-cache/hub/models--istupakov--gigaam-v3-onnx/snapshots/322c3b29492673eb7d0b434bfa9dfb8653e34d02')
)
const preprocessorPath = join(packageRoot, 'assets/gigaam_v3.onnx')
const acousticPath = join(modelDir, 'v3_e2e_ctc.int8.onnx')
const vocabPath = join(modelDir, 'v3_e2e_ctc_vocab.txt')
const audioDir = join(bench, 'data/audio')
const baselinePath = join(bench, 'out/raw/gigaam-v3-e2e-ctc.json')
const ids = ['n01', 'n02', 'n03', 'n04', 'n05']

ort.env.logLevel = 'error'

function readWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let offset = 12
  let fmt
  let data
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > buffer.length) throw new Error(`truncated ${id} chunk`)
    if (id === 'fmt ') {
      fmt = {
        format: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14)
      }
    } else if (id === 'data') {
      data = buffer.subarray(start, start + size)
    }
    offset = start + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk')
  if (fmt.format !== 1 || fmt.channels !== 1 || fmt.sampleRate !== 16000 || fmt.bitsPerSample !== 16) {
    throw new Error(`unsupported WAV: ${JSON.stringify(fmt)}`)
  }
  const samples = new Float32Array(data.length / 2)
  for (let i = 0; i < samples.length; i += 1) samples[i] = data.readInt16LE(i * 2) / 32768
  return samples
}

function decodeCtc(logits, dims, vocab, blankId) {
  const [, timeSteps, vocabSize] = dims
  let previous = -1
  let text = ''
  for (let t = 0; t < timeSteps; t += 1) {
    let best = 0
    let bestValue = logits[t * vocabSize]
    for (let id = 1; id < vocabSize; id += 1) {
      const value = logits[t * vocabSize + id]
      if (value > bestValue) { bestValue = value; best = id }
    }
    if (best === previous) continue
    previous = best
    if (best === blankId) continue
    const token = vocab[best] ?? ''
    text += token === '▁' ? ' ' : token
  }
  return text.replace(/▁/g, ' ').replace(/ +/g, ' ').trim()
}

function normalize(text) {
  return text.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim()
}

async function dirSize(path) {
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    total += entry.isDirectory() ? await dirSize(child) : (await stat(child)).size
  }
  return total
}

const started = performance.now()
const [preprocessor, acoustic] = await Promise.all([
  ort.InferenceSession.create(preprocessorPath, { intraOpNumThreads: 4, interOpNumThreads: 1 }),
  ort.InferenceSession.create(acousticPath, { intraOpNumThreads: 4, interOpNumThreads: 1 })
])
const loadSeconds = (performance.now() - started) / 1000

const vocab = []
for (const line of (await readFile(vocabPath, 'utf8')).split(/\r?\n/u)) {
  const match = /^(.*)\s+(\d+)$/u.exec(line)
  if (match) vocab[Number(match[2])] = match[1]
}
const blankId = vocab.indexOf('<blk>')
if (blankId < 0) throw new Error('blank token <blk> not found in vocab')

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const reference = new Map(baseline.passes[0].map((item) => [item.id, item.text]))

async function recognize(id) {
  const samples = readWav(await readFile(join(audioDir, `${id}.wav`)))
  const waveforms = new ort.Tensor('float32', samples, [1, samples.length])
  const waveformsLens = new ort.Tensor('int64', BigInt64Array.from([BigInt(samples.length)]), [1])
  const startedAt = performance.now()
  const pre = await preprocessor.run({ waveforms, waveforms_lens: waveformsLens })
  const features = pre.features
  const featuresLens = pre.features_lens
  const out = await acoustic.run({ features, feature_lengths: featuresLens })
  const logProbs = out.log_probs ?? out[Object.keys(out)[0]]
  const latency = (performance.now() - startedAt) / 1000
  return { text: decodeCtc(logProbs.data, logProbs.dims, vocab, blankId), latency }
}

const warmup = await recognize('n01')
const cases = []
for (const id of ids) {
  const result = await recognize(id)
  cases.push({
    id,
    text: result.text,
    latency_s: Number(result.latency.toFixed(4)),
    reference: reference.get(id) ?? null,
    match: normalize(result.text) === normalize(reference.get(id) ?? '')
  })
}

const latencies = cases.map((item) => item.latency_s).sort((a, b) => a - b)
const p50 = latencies[Math.floor(latencies.length / 2)]
const rssMb = process.memoryUsage().rss / 1024 / 1024
const ortDir = resolve(packageRoot, 'node_modules/onnxruntime-node')
const installBytes = (await dirSize(ortDir)) + (await stat(preprocessorPath)).size + (await stat(acousticPath)).size
const result = {
  ok: cases.every((item) => item.match) && p50 <= 0.35 && rssMb <= 700 && installBytes <= 500 * 1024 * 1024,
  load_s: Number(loadSeconds.toFixed(3)),
  warmup_s: Number(warmup.latency.toFixed(4)),
  p50,
  rss_mb: Number(rssMb.toFixed(1)),
  install_mb: Number((installBytes / 1024 / 1024).toFixed(1)),
  cases
}
console.log(JSON.stringify(result, null, 2))
