import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'

export type EssentiaRhythmResult = {
  bpm: number
  beatOffset: number
  ticks: number[]
  confidence: number
}

type EssentiaInstance = {
  arrayToVector(values: Float32Array): { delete?: () => void }
  RhythmExtractor2013(signal: unknown, maxTempo?: number, method?: string, minTempo?: number): {
    bpm?: number
    ticks?: unknown
    confidence?: number
  }
}

type EssentiaConstructor = new (wasm: unknown) => EssentiaInstance

let essentiaPromise: Promise<EssentiaInstance> | undefined
const analysisCache = new WeakMap<Blob, Promise<EssentiaRhythmResult>>()

async function getEssentia(): Promise<EssentiaInstance> {
  if (!essentiaPromise) {
    essentiaPromise = Promise.resolve().then(() => {
      const Constructor = Essentia as unknown as EssentiaConstructor
      return new Constructor(EssentiaWASM)
    })
  }
  return essentiaPromise
}

function valuesFromVector(value: unknown): number[] {
  if (!value) return []
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Array.from(value as ArrayLike<number>, Number).filter(Number.isFinite)
  }
  const vector = value as { size?: () => number; get?: (index: number) => number; toArray?: () => number[] }
  if (typeof vector.toArray === 'function') return vector.toArray().filter(Number.isFinite)
  if (typeof vector.size === 'function' && typeof vector.get === 'function') {
    const result: number[] = []
    for (let i = 0; i < vector.size(); i++) {
      const item = vector.get(i)
      if (Number.isFinite(item)) result.push(item)
    }
    return result
  }
  return []
}

async function runAnalysis(blob: Blob): Promise<EssentiaRhythmResult> {
  if (!blob.size) throw new Error('Empty audio file')

  const AudioContextClass = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) throw new Error('Web Audio API is unavailable')

  const decodeContext = new AudioContextClass()
  let essentia: EssentiaInstance | undefined
  let signalVector: { delete?: () => void } | undefined

  try {
    const decoded = await decodeContext.decodeAudioData(await blob.arrayBuffer())
    const seconds = Math.min(90, decoded.duration)
    if (!Number.isFinite(seconds) || seconds < 6 || decoded.numberOfChannels < 1) {
      throw new Error('Audio is too short to analyse')
    }

    // Essentia's rhythm algorithms expect a 44.1 kHz mono signal.
    // OfflineAudioContext performs proper resampling and channel downmixing.
    const sampleRate = 44100
    const frameCount = Math.floor(seconds * sampleRate)
    const OfflineContext = window.OfflineAudioContext ||
      (window as typeof window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
    if (!OfflineContext) throw new Error('OfflineAudioContext is unavailable')

    const offline = new OfflineContext(1, frameCount, sampleRate)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start(0, 0, seconds)
    const resampled = await offline.startRendering()
    const mono = resampled.getChannelData(0)

    essentia = await getEssentia()
    signalVector = essentia.arrayToVector(mono)
    const output = essentia.RhythmExtractor2013(signalVector, 208, 'multifeature', 40)
    const bpmValue = Number(output.bpm)
    const ticks = valuesFromVector(output.ticks).filter((tick) => tick >= 0 && tick < seconds).sort((a, b) => a - b)
    if (!Number.isFinite(bpmValue) || bpmValue < 40 || bpmValue > 208 || ticks.length < 2) {
      throw new Error('Essentia could not confidently detect a beat grid')
    }

    const bpm = Math.round(bpmValue)
    const beatPeriod = 60 / bpm
    // Use the first detected beat's phase, not an assumed zero-time downbeat.
    const beatOffset = ((ticks[0] % beatPeriod) + beatPeriod) % beatPeriod
    return {
      bpm,
      beatOffset,
      ticks,
      confidence: Number.isFinite(Number(output.confidence)) ? Number(output.confidence) : 0,
    }
  } finally {
    signalVector?.delete?.()
    await decodeContext.close().catch(() => undefined)
  }
}

export function analyzeEssentiaRhythm(blob: Blob): Promise<EssentiaRhythmResult> {
  const cached = analysisCache.get(blob)
  if (cached) return cached

  const analysis = runAnalysis(blob).catch((error) => {
    analysisCache.delete(blob)
    throw error
  })
  analysisCache.set(blob, analysis)
  return analysis
}
