export type EssentiaRhythmResult = {
  bpm: number
  beatPeriod: number
  beatOffset: number
  ticks: number[]
  confidence: number
}

type WorkerResult = { id: number; result?: { bpm: number; ticks: number[]; confidence: number }; error?: string }
type PendingRequest = { resolve: (value: WorkerResult['result']) => void; reject: (error: Error) => void }

const analysisCache = new WeakMap<Blob, Promise<EssentiaRhythmResult>>()
let rhythmWorker: Worker | undefined
let nextRequestId = 1
const pendingRequests = new Map<number, PendingRequest>()

function getRhythmWorker(): Worker {
  if (rhythmWorker) return rhythmWorker
  rhythmWorker = new Worker(new URL('./essentiaRhythm.worker.ts', import.meta.url), { type: 'module' })
  rhythmWorker.onmessage = (event: MessageEvent<WorkerResult>) => {
    const pending = pendingRequests.get(event.data.id)
    if (!pending) return
    pendingRequests.delete(event.data.id)
    if (event.data.error || !event.data.result) pending.reject(new Error(event.data.error || 'Essentia analysis failed'))
    else pending.resolve(event.data.result)
  }
  rhythmWorker.onerror = () => {
    for (const pending of pendingRequests.values()) pending.reject(new Error('Rhythm worker failed'))
    pendingRequests.clear()
    rhythmWorker?.terminate()
    rhythmWorker = undefined
  }
  return rhythmWorker
}

function extractInWorker(samples: Float32Array): Promise<NonNullable<WorkerResult['result']>> {
  const worker = getRhythmWorker()
  const id = nextRequestId++
  const copy = samples.slice()
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve: (result) => result ? resolve(result) : reject(new Error('Empty Essentia result')), reject })
    worker.postMessage({ id, samples: copy.buffer }, [copy.buffer])
  })
}

async function runAnalysis(blob: Blob): Promise<EssentiaRhythmResult> {
  if (!blob.size) throw new Error('Empty audio file')
  const AudioContextClass = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) throw new Error('Web Audio API is unavailable')

  const decodeContext = new AudioContextClass()
  try {
    const decoded = await decodeContext.decodeAudioData(await blob.arrayBuffer())
    const seconds = Math.min(90, decoded.duration)
    if (!Number.isFinite(seconds) || seconds < 6 || decoded.numberOfChannels < 1) throw new Error('Audio is too short to analyse')

    // Decode and resample off the live playback graph; run CPU-heavy rhythm extraction in a Worker.
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
    const output = await extractInWorker(resampled.getChannelData(0))
    const rawTicks = output.ticks.filter((tick) => tick >= 0 && tick < seconds).sort((a, b) => a - b)
    if (rawTicks.length < 2) throw new Error('Essentia could not confidently detect a beat grid')

    // Keep sub-BPM precision. Robustly estimate the beat interval from Essentia's actual ticks,
    // rejecting intervals that look like missed beats or subdivisions.
    const expectedPeriod = 60 / output.bpm
    const intervals = rawTicks.slice(1).map((tick, index) => tick - rawTicks[index])
      .filter((interval) => interval >= expectedPeriod * 0.78 && interval <= expectedPeriod * 1.22)
      .sort((a, b) => a - b)
    const beatPeriod = intervals.length
      ? intervals[Math.floor(intervals.length / 2)]
      : expectedPeriod
    const bpm = Math.round(60 / beatPeriod)
    const beatOffset = ((rawTicks[0] % beatPeriod) + beatPeriod) % beatPeriod
    return { bpm, beatPeriod, beatOffset, ticks: rawTicks, confidence: output.confidence }
  } finally {
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
