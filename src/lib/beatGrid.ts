import { analyzeEssentiaRhythm } from './essentiaRhythm'

export type BeatGridResult = { bpm?: number; beatOffset: number; beatPeriod: number; ticks: number[] }

export async function detectBeatGrid(blob: Blob, knownBpm?: number): Promise<BeatGridResult> {
  const result = await analyzeEssentiaRhythm(blob)
  return {
    bpm: knownBpm ?? result.bpm,
    beatOffset: result.beatOffset,
    beatPeriod: result.beatPeriod,
    ticks: result.ticks,
  }
}
