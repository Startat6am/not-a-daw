export async function detectBpm(blob: Blob): Promise<number | undefined> {
  const scope = window as typeof window & { webkitAudioContext?: typeof AudioContext }
  const AudioContextClass = window.AudioContext || scope.webkitAudioContext
  if (!AudioContextClass || !blob.size) return undefined

  const context = new AudioContextClass()
  try {
    const raw = await blob.arrayBuffer()
    const buffer = await context.decodeAudioData(raw)
    const sampleRate = buffer.sampleRate
    const seconds = Math.min(75, buffer.duration)
    if (!Number.isFinite(seconds) || seconds < 6 || buffer.numberOfChannels < 1) return undefined

    // Compress the audio into a 100 Hz RMS envelope; tempo analysis then stays
    // lightweight even for long tracks and works on mono or stereo files.
    const frameSize = Math.max(1, Math.round(sampleRate / 100))
    const frameCount = Math.floor(seconds * sampleRate / frameSize)
    if (frameCount < 600) return undefined
    const envelope = new Float64Array(frameCount)
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    const maxSamples = Math.min(buffer.length, Math.floor(seconds * sampleRate))
    for (let frame = 0; frame < frameCount; frame++) {
      const start = frame * frameSize
      const end = Math.min(start + frameSize, maxSamples)
      let energy = 0
      for (let i = start; i < end; i++) {
        let sample = 0
        for (const channel of channels) sample += channel[i] || 0
        sample /= channels.length
        energy += sample * sample
      }
      envelope[frame] = Math.sqrt(energy / Math.max(1, end - start))
    }

    // Positive energy changes emphasize drum hits and other transients.
    const onset = new Float64Array(frameCount)
    let mean = 0
    for (let i = 1; i < frameCount; i++) {
      onset[i] = Math.max(0, envelope[i] - envelope[i - 1])
      mean += onset[i]
    }
    mean /= frameCount
    let variance = 0
    for (let i = 1; i < frameCount; i++) {
      onset[i] = Math.max(0, onset[i] - mean * 0.35)
      variance += onset[i] * onset[i]
    }
    if (variance < 1e-10) return undefined

    // 100 frames/second means a beat lag is 33–100 frames for 180–60 BPM.
    const minLag = 33
    const maxLag = Math.min(100, Math.floor(frameCount / 3))
    const correlations = new Float64Array(maxLag + 1)
    for (let lag = minLag; lag <= maxLag; lag++) {
      let product = 0
      let leftEnergy = 0
      let rightEnergy = 0
      for (let i = lag; i < frameCount; i++) {
        const left = onset[i]
        const right = onset[i - lag]
        product += left * right
        leftEnergy += left * left
        rightEnergy += right * right
      }
      const denom = Math.sqrt(leftEnergy * rightEnergy)
      correlations[lag] = denom > 0 ? product / denom : 0
    }

    let bestLag = 0
    let bestScore = -1
    for (let lag = minLag; lag <= maxLag; lag++) {
      // A real beat often has energy at both the beat and bar/subdivision
      // intervals. Harmonics help avoid mistaking every other kick for the beat.
      let score = correlations[lag]
      if (lag * 2 <= maxLag) score += correlations[lag * 2] * 0.28
      const halfLag = Math.round(lag / 2)
      if (halfLag >= minLag) score += correlations[halfLag] * 0.12
      if (score > bestScore) { bestScore = score; bestLag = lag }
    }
    if (!bestLag || bestScore <= 0.015) return undefined

    const bpm = Math.round(6000 / bestLag)
    return bpm >= 60 && bpm <= 180 ? bpm : undefined
  } finally {
    await context.close().catch(() => undefined)
  }
}
