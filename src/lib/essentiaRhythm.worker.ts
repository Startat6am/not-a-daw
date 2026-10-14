import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'

type Instance = {
  arrayToVector(values: Float32Array): { delete?: () => void }
  RhythmExtractor2013(signal: unknown, maxTempo?: number, method?: string, minTempo?: number): {
    bpm?: number
    ticks?: unknown
    confidence?: number
  }
}
type Request = { id: number; samples: ArrayBuffer }
type Response = { id: number; result?: { bpm: number; ticks: number[]; confidence: number }; error?: string }

function vectorValues(value: unknown): number[] {
  if (!value) return []
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value as ArrayLike<number>, Number).filter(Number.isFinite)
  const vector = value as { size?: () => number; get?: (index: number) => number; toArray?: () => number[] }
  if (typeof vector.toArray === 'function') return vector.toArray().filter(Number.isFinite)
  if (typeof vector.size === 'function' && typeof vector.get === 'function') {
    const values: number[] = []
    for (let i = 0; i < vector.size(); i++) {
      const item = vector.get(i)
      if (Number.isFinite(item)) values.push(item)
    }
    return values
  }
  return []
}

let essentia: Instance | undefined
let initPromise: Promise<Instance> | undefined
async function getEssentia(): Promise<Instance> {
  if (!initPromise) initPromise = Promise.resolve().then(() => new (Essentia as unknown as new (wasm: unknown) => Instance)(EssentiaWASM))
  essentia = await initPromise
  return essentia
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, samples } = event.data
  let signal: { delete?: () => void } | undefined
  try {
    const engine = await getEssentia()
    signal = engine.arrayToVector(new Float32Array(samples))
    const output = engine.RhythmExtractor2013(signal, 208, 'multifeature', 40)
    const bpm = Number(output.bpm)
    const ticks = vectorValues(output.ticks).filter((tick) => tick >= 0 && Number.isFinite(tick)).sort((a, b) => a - b)
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 208 || ticks.length < 2) throw new Error('Essentia could not confidently detect a beat grid')
    const response: Response = {
      id,
      result: { bpm, ticks, confidence: Number.isFinite(Number(output.confidence)) ? Number(output.confidence) : 0 },
    }
    self.postMessage(response)
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Essentia analysis failed' } satisfies Response)
  } finally {
    signal?.delete?.()
  }
}
