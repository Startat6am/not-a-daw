export type BeatGridResult = { bpm?: number; beatOffset: number }

export async function detectBeatGrid(blob: Blob, knownBpm?: number): Promise<BeatGridResult> {
  const scope = window as typeof window & { webkitAudioContext?: typeof AudioContext }
  const AudioContextClass = window.AudioContext || scope.webkitAudioContext
  if (!AudioContextClass || !blob.size) return { bpm: knownBpm, beatOffset: 0 }

  const context = new AudioContextClass()
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    const seconds = Math.min(90, buffer.duration)
    if (!Number.isFinite(seconds) || seconds < 6 || !buffer.numberOfChannels) {
      return { bpm: knownBpm, beatOffset: 0 }
    }

    // A compact 100 Hz energy envelope gives enough timing precision for a beat grid
    // without running a heavy FFT over the full-resolution audio on the UI thread.
    const rate = 100
    const frameSize = Math.max(1, Math.round(buffer.sampleRate / rate))
    const frames = Math.floor(seconds * rate)
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    const envelope = new Float32Array(frames)
    for (let frame = 0; frame < frames; frame++) {
      const start = frame * frameSize
      const end = Math.min(start + frameSize, buffer.length)
      let energy = 0
      for (let i = start; i < end; i++) {
        let sample = 0
        for (const channel of channels) sample += channel[i] || 0
        sample /= channels.length
        energy += sample * sample
      }
      envelope[frame] = Math.sqrt(energy / Math.max(1, end - start))
    }

    // Spectral flux is ideal for onset detection; positive energy differences are
    // a lightweight browser-native approximation that works well for kick transients.
    const onset = new Float32Array(frames)
    let mean = 0
    for (let i = 1; i < frames; i++) {
      onset[i] = Math.max(0, envelope[i] - envelope[i - 1])
      mean += onset[i]
    }
    mean /= frames
    for (let i = 1; i < frames; i++) onset[i] = Math.max(0, onset[i] - mean * 0.25)

    let bpm = knownBpm
    if (!bpm) {
      let bestLag = 0
      let bestScore = -1
      for (let lag = 33; lag <= Math.min(100, Math.floor(frames / 3)); lag++) {
        let score = 0
        for (let i = lag; i < frames; i++) score += onset[i] * onset[i - lag]
        if (score > bestScore) { bestScore = score; bestLag = lag }
      }
      if (bestLag) bpm = Math.round(6000 / bestLag)
    }
    if (!bpm || bpm < 60 || bpm > 180) return { bpm, beatOffset: 0 }

    const periodFrames = rate * 60 / bpm
    // Test every 10 ms phase and score how consistently transients land on the beat.
    // A small local window tolerates encoder delay and slightly soft attacks.
    const maxPhase = Math.max(1, Math.round(periodFrames))
    let bestPhase = 0
    let bestScore = -1
    const usableFrames = Math.min(frames, 45 * rate)
    for (let phase = 0; phase < maxPhase; phase++) {
      let score = 0
      let count = 0
      for (let beat = phase; beat < usableFrames; beat += periodFrames) {
        let local = 0
        for (let delta = -2; delta <= 2; delta++) {
          const index = Math.round(beat) + delta
          if (index >= 0 && index < usableFrames) local = Math.max(local, onset[index])
        }
        score += local
        count++
      }
      const normalized = count ? score / count : 0
      if (normalized > bestScore) { bestScore = normalized; bestPhase = phase }
    }
    return { bpm, beatOffset: bestPhase / rate }
  } finally {
    await context.close().catch(() => undefined)
  }
}
