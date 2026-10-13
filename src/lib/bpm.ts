export async function detectBpm(blob: Blob): Promise<number | undefined> {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return undefined
  const context = new AudioContextClass()
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    const sampleRate = buffer.sampleRate
    const channelCount = buffer.numberOfChannels
    const seconds = Math.min(60, buffer.duration)
    if (!Number.isFinite(seconds) || seconds < 8) return undefined
    const frameSize = Math.max(1, Math.floor(sampleRate * 0.01))
    const frameCount = Math.floor(seconds * sampleRate / frameSize)
    const envelope = new Float64Array(frameCount)
    const channels = Array.from({ length: channelCount }, (_, i) => buffer.getChannelData(i))
    for (let frame = 0; frame < frameCount; frame++) {
      const start = frame * frameSize
      const end = Math.min(start + frameSize, Math.floor(seconds * sampleRate))
      let energy = 0
      for (let i = start; i < end; i++) {
        let sample = 0
        for (const channel of channels) sample += channel[i] || 0
        sample /= channelCount
        energy += sample * sample
      }
      envelope[frame] = Math.sqrt(energy / Math.max(1, end - start))
    }
    const onset = new Float64Array(frameCount)
    let mean = 0
    for (let i = 1; i < frameCount; i++) { onset[i] = Math.max(0, envelope[i] - envelope[i - 1]); mean += onset[i] }
    mean /= frameCount
    if (mean < 0.00001) return undefined
    let variance = 0
    for (let i = 0; i < frameCount; i++) { onset[i] -= mean; variance += onset[i] * onset[i] }
    if (variance < 1e-8) return undefined
    const minLag = Math.max(1, Math.floor(6000 / 180))
    const maxLag = Math.min(frameCount - 1, Math.ceil(6000 / 60))
    let bestLag = 0
    let bestScore = -Infinity
    const scores: number[] = []
    for (let lag = minLag; lag <= maxLag; lag++) {
      let score = 0
      for (let i = lag; i < frameCount; i++) score += onset[i] * onset[i - lag]
      scores.push(score)
      if (score > bestScore) { bestScore = score; bestLag = lag }
    }
    if (!bestLag || bestScore <= 0) return undefined
    // If the double-tempo peak is nearly as strong, choose the slower pulse.
    for (let lag = Math.max(minLag, Math.floor(bestLag * 1.95)); lag <= Math.min(maxLag, Math.ceil(bestLag * 2.05)); lag++) {
      const score = scores[lag - minLag]
      if (score !== undefined && score >= bestScore * 0.9) { bestLag = lag; break }
    }
    const bpm = Math.round(6000 / bestLag)
    return bpm >= 60 && bpm <= 180 ? bpm : undefined
  } finally {
    await context.close().catch(() => undefined)
  }
}
