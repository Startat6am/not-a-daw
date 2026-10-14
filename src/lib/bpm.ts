import { analyzeEssentiaRhythm } from './essentiaRhythm'

export async function detectBpm(blob: Blob): Promise<number | undefined> {
  try {
    const result = await analyzeEssentiaRhythm(blob)
    return result.bpm
  } catch (error) {
    console.warn('Essentia BPM analysis failed:', error)
    return undefined
  }
}
