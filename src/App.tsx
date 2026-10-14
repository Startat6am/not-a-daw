import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { addTracks, deleteTrack, getTracks, type LocalTrack } from './lib/audioLibrary'
import { detectBpm } from './lib/bpm'
import { detectBeatGrid } from './lib/beatGrid'

function formatDuration(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—:—'
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}
function formatBitrate(bytes: number, duration?: number) {
  if (!duration || !Number.isFinite(duration) || duration <= 0 || bytes <= 0) return 'битрейт —'
  const kbps = Math.round(bytes * 8 / duration / 1000)
  return kbps > 0 ? `${kbps} kbps` : 'битрейт —'
}
function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B'
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type WaveformLevel = { min: Float32Array; max: Float32Array }
type WaveformPyramid = { levels: WaveformLevel[]; length: number; duration: number; peak: number; colors: Uint8Array }

const waveformCache = new WeakMap<Blob, Promise<WaveformPyramid>>()
function getWaveformPeaks(blob: Blob, bins = 16384): Promise<WaveformPyramid> {
  const cached = waveformCache.get(blob)
  if (cached) return cached
  const task = (async () => {
    const scope = window as typeof window & { webkitAudioContext?: typeof AudioContext }
    const AudioContextClass = window.AudioContext || scope.webkitAudioContext
    if (!AudioContextClass || !blob.size) throw new Error('Waveform decoding unavailable')
    const context = new AudioContextClass()
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer())
      if (!buffer.length || !buffer.duration) throw new Error('Empty audio buffer')
      const count = Math.min(bins, buffer.length)
      const min = new Float32Array(count)
      const max = new Float32Array(count)
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
      let globalPeak = 0
      for (let bin = 0; bin < count; bin++) {
        const start = Math.floor(bin * buffer.length / count)
        const end = Math.max(start + 1, Math.floor((bin + 1) * buffer.length / count))
        let lo = 1
        let hi = -1
        for (const channel of channels) {
          for (let sample = start; sample < Math.min(end, buffer.length); sample++) {
            const value = channel[sample] || 0
            if (value < lo) lo = value
            if (value > hi) hi = value
          }
        }
        min[bin] = lo
        max[bin] = hi
        globalPeak = Math.max(globalPeak, Math.abs(lo), Math.abs(hi))
      }
      // Analyze the track in short windows. Goertzel probes approximate bass, midrange and treble energy.
      // Each time slice gets its own color, so both decks show the same track-specific palette.
      const colorCount = Math.min(256, Math.max(48, Math.floor(buffer.duration * 1.5)))
      const colors = new Uint8Array(colorCount * 3)
      const probes = [70, 140, 350, 1200, 4000, 9000].filter((hz) => hz < buffer.sampleRate * 0.47)
      const bandColors = [[255, 78, 48], [255, 194, 72], [64, 190, 255]]
      const windowSize = 512
      for (let frame = 0; frame < colorCount; frame++) {
        const center = Math.floor((frame + 0.5) / colorCount * buffer.length)
        const start = Math.max(0, Math.min(buffer.length - windowSize, center - Math.floor(windowSize / 2)))
        const sampleCount = Math.min(windowSize, buffer.length - start)
        const energies = [0, 0, 0]
        for (let p = 0; p < probes.length; p++) {
          const omega = 2 * Math.PI * probes[p] / buffer.sampleRate
          const coeff = 2 * Math.cos(omega)
          let q1 = 0, q2 = 0
          for (let i = 0; i < sampleCount; i++) {
            const sample = channels.reduce((sum, channel) => sum + (channel[start + i] || 0), 0) / channels.length
            const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.max(1, sampleCount - 1))
            const q0 = sample * window + coeff * q1 - q2
            q2 = q1; q1 = q0
          }
          const energy = Math.max(0, q1 * q1 + q2 * q2 - coeff * q1 * q2)
          energies[Math.floor(p / Math.max(1, probes.length) * 3)] += energy
        }
        const total = energies.reduce((sum, value) => sum + value, 0) || 1
        const weights = energies.map((value) => Math.sqrt(value / total))
        const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1
        for (let channel = 0; channel < 3; channel++) {
          colors[frame * 3 + channel] = Math.round(weights.reduce((sum, weight, band) => sum + weight * bandColors[band][channel], 0) / weightTotal)
        }
      }
      const levels: WaveformLevel[] = [{ min, max }]
      while (levels[levels.length - 1].min.length > 1) {
        const previous = levels[levels.length - 1]
        const nextLength = Math.ceil(previous.min.length / 2)
        const nextMin = new Float32Array(nextLength)
        const nextMax = new Float32Array(nextLength)
        for (let index = 0; index < nextLength; index++) {
          const left = index * 2
          const right = Math.min(left + 1, previous.min.length - 1)
          nextMin[index] = Math.min(previous.min[left], previous.min[right])
          nextMax[index] = Math.max(previous.max[left], previous.max[right])
        }
        levels.push({ min: nextMin, max: nextMax })
      }
      return { levels, length: count, duration: buffer.duration, peak: globalPeak || 1, colors }
    } finally {
      await context.close().catch(() => undefined)
    }
  })()
  waveformCache.set(blob, task)
  return task
}

function WaveformCanvas({ waveform, time, zoom, duration }: { waveform: WaveformPyramid | null; time: number; zoom: number; duration: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (!width || !height) return
      const ratio = Math.max(1, window.devicePixelRatio || 1)
      const pixelWidth = Math.round(width * ratio)
      const pixelHeight = Math.round(height * ratio)
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth
        canvas.height = pixelHeight
      }
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      if (!waveform || !duration || !waveform.length) return

      const binsPerPixel = waveform.length / waveform.duration / zoom
      const levelIndex = Math.max(0, Math.min(waveform.levels.length - 1, Math.floor(Math.log2(Math.max(1, binsPerPixel)))))
      const level = waveform.levels[levelIndex]
      const bucketSize = 2 ** levelIndex
      const centerY = height / 2
      const amplitude = height * 0.49
      const xStart = Math.max(0, Math.ceil(width / 2 - time * zoom))
      const xEnd = Math.min(width - 1, Math.floor(width / 2 + (waveform.duration - time) * zoom))
      if (xEnd < xStart) return
      context.globalAlpha = 0.92
      for (let x = xStart; x <= xEnd; x++) {
        const sampleTime = time + (x - width / 2) / zoom
        const baseIndex = Math.max(0, Math.min(waveform.length - 1, Math.floor(sampleTime / waveform.duration * waveform.length)))
        const index = Math.min(level.min.length - 1, Math.floor(baseIndex / bucketSize))
        const hi = Math.max(0, level.max[index] / waveform.peak)
        const lo = Math.min(0, level.min[index] / waveform.peak)
        const top = centerY - Math.pow(hi, 0.68) * amplitude
        const bottom = centerY - Math.sign(lo) * Math.pow(Math.abs(lo), 0.68) * amplitude
        const colorIndex = Math.min(waveform.colors.length / 3 - 1, Math.max(0, Math.floor(sampleTime / waveform.duration * (waveform.colors.length / 3))))
        const ci = colorIndex * 3
        context.fillStyle = `rgb(${waveform.colors[ci]},${waveform.colors[ci + 1]},${waveform.colors[ci + 2]})`
        context.fillRect(x, top, 1.5, Math.max(1, bottom - top))
      }
      context.globalAlpha = 1
    }
    draw()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null
    observer?.observe(canvas)
    window.addEventListener('resize', draw)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', draw)
    }
  }, [waveform, time, zoom, duration])
  return <canvas ref={canvasRef} className="waveform-canvas" aria-hidden="true" />
}

type TelegramTrack = { updateId: number; fileId: string; name: string; type: string; size: number; duration?: number; caption?: string }

function makeId() { return `track-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}` }
function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => { const duration = audio.duration; URL.revokeObjectURL(url); resolve(Number.isFinite(duration) ? duration : undefined) }
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(undefined) }
    audio.src = url
  })
}

export default function App() {
  const [tracks, setTracks] = useState<LocalTrack[]>([])
  const [deckA, setDeckA] = useState<string | null>(null)
  const [deckB, setDeckB] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [picker, setPicker] = useState<'A' | 'B' | null>(null)
  const [crossfade, setCrossfade] = useState(50)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [srcA, setSrcA] = useState('')
  const [srcB, setSrcB] = useState('')
  const [timeA, setTimeA] = useState(0)
  const [timeB, setTimeB] = useState(0)
  const [durationA, setDurationA] = useState(0)
  const [durationB, setDurationB] = useState(0)
  const [playingA, setPlayingA] = useState(false)
  const [playingB, setPlayingB] = useState(false)
  const [syncFeedback, setSyncFeedback] = useState('')
  const [syncRates, setSyncRates] = useState<{ A: number; B: number }>({ A: 1, B: 1 })
  const [syncArmed, setSyncArmed] = useState<{ A: boolean; B: boolean }>({ A: false, B: false })
  const [telegramTracks, setTelegramTracks] = useState<TelegramTrack[]>([])
  const [telegramMaxUpdateId, setTelegramMaxUpdateId] = useState<number | null>(null)
  const [telegramDiagnostics, setTelegramDiagnostics] = useState<{ botUsername: string | null; webhookEnabled: boolean; webhookPendingCount: number; pendingUpdates: number; privateMessages: number; recognizedAudioFiles: number } | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<{ fileId: string; loaded: number; total: number; stage: 'downloading' | 'saving' } | null>(null)
  const [telegramOpen, setTelegramOpen] = useState(false)
  const [telegramBusy, setTelegramBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const touchStartX = useRef<number | null>(null)
  const [swipedTrackId, setSwipedTrackId] = useState<string | null>(null)
  const [detailTrackId, setDetailTrackId] = useState<string | null>(null)
  const bpmAnalyzing = useRef(new Set<string>())
  const bpmAttempted = useRef(new Set<string>())
  const beatGridAnalyzing = useRef(new Set<string>())
  const beatGridAttempted = useRef(new Set<string>())
  const audioA = useRef<HTMLAudioElement>(null)
  const audioB = useRef<HTMLAudioElement>(null)
  const loadedA = tracks.find((track) => track.id === deckA)
  const loadedB = tracks.find((track) => track.id === deckB)
  const detailTrack = tracks.find((track) => track.id === detailTrackId)

  const refresh = useCallback(() => { getTracks().then(setTracks).catch(() => setError('Не удалось открыть библиотеку')) }, [])
  useEffect(() => {
    refresh()
    const handlePrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as BeforeInstallPromptEvent) }
    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('beforeinstallprompt', handlePrompt); window.removeEventListener('focus', refresh) }
  }, [refresh])

  useEffect(() => {
    if (!loadedA) { setSrcA(''); setTimeA(0); setDurationA(0); setPlayingA(false); if (audioA.current) { audioA.current.pause(); audioA.current.playbackRate = 1 }; setSyncRates((r) => ({ ...r, A: 1 })); setSyncArmed((r) => ({ ...r, A: false })); return }
    const url = URL.createObjectURL(loadedA.blob)
    if (audioA.current) { audioA.current.pause(); audioA.current.currentTime = 0; audioA.current.playbackRate = 1 }
    setTimeA(0); setPlayingA(false); setSrcA(url); setSyncRates((r) => ({ ...r, A: 1 })); setSyncArmed((r) => ({ ...r, A: false }))
    return () => URL.revokeObjectURL(url)
  }, [loadedA])
  useEffect(() => {
    if (!loadedB) { setSrcB(''); setTimeB(0); setDurationB(0); setPlayingB(false); if (audioB.current) { audioB.current.pause(); audioB.current.playbackRate = 1 }; setSyncRates((r) => ({ ...r, B: 1 })); setSyncArmed((r) => ({ ...r, B: false })); return }
    const url = URL.createObjectURL(loadedB.blob)
    if (audioB.current) { audioB.current.pause(); audioB.current.currentTime = 0; audioB.current.playbackRate = 1 }
    setTimeB(0); setPlayingB(false); setSrcB(url); setSyncRates((r) => ({ ...r, B: 1 })); setSyncArmed((r) => ({ ...r, B: false }))
    return () => URL.revokeObjectURL(url)
  }, [loadedB])

  useEffect(() => {
    const pending = tracks.filter((track) => !track.bpm && !bpmAttempted.current.has(track.id) && !bpmAnalyzing.current.has(track.id))
    for (const track of pending) {
      bpmAnalyzing.current.add(track.id)
      bpmAttempted.current.add(track.id)
      const analyzingTrack = { ...track, bpmStatus: 'pending' as const }
      setTracks((current) => current.map((item) => item.id === track.id ? analyzingTrack : item))
      void (async () => {
        let updatedTrack: LocalTrack
        try {
          const bpm = await detectBpm(track.blob)
          updatedTrack = { ...analyzingTrack, bpm, bpmStatus: bpm ? 'ready' : 'unavailable' }
          await addTracks([updatedTrack])
        } catch {
          updatedTrack = { ...analyzingTrack, bpmStatus: 'unavailable' }
          await addTracks([updatedTrack]).catch(() => undefined)
        } finally {
          bpmAnalyzing.current.delete(track.id)
        }
        setTracks((current) => current.map((item) => item.id === track.id ? updatedTrack : item))
      })()
    }
  }, [tracks])

  useEffect(() => {
    const pending = tracks.filter((track) => track.bpm && (track.beatOffset === undefined || track.beatPeriod === undefined) && !beatGridAttempted.current.has(track.id) && !beatGridAnalyzing.current.has(track.id))
    for (const track of pending) {
      beatGridAttempted.current.add(track.id)
      beatGridAnalyzing.current.add(track.id)
      void (async () => {
        try {
          const grid = await detectBeatGrid(track.blob, track.bpm)
          const updated: LocalTrack = { ...track, bpm: grid.bpm ?? track.bpm, beatOffset: grid.beatOffset, beatPeriod: grid.beatPeriod, bpmStatus: 'ready' }
          await addTracks([updated])
          setTracks((current) => current.map((item) => item.id === track.id ? updated : item))
        } catch {
          const updated: LocalTrack = { ...track, beatOffset: 0, beatPeriod: track.bpm ? 60 / track.bpm : undefined }
          await addTracks([updated]).catch(() => undefined)
          setTracks((current) => current.map((item) => item.id === track.id ? updated : item))
        } finally { beatGridAnalyzing.current.delete(track.id) }
      })()
    }
  }, [tracks])

  useEffect(() => {
    const p = crossfade / 100
    if (audioA.current) audioA.current.volume = Math.cos(p * Math.PI / 2)
    if (audioB.current) audioB.current.volume = Math.sin(p * Math.PI / 2)
  }, [crossfade, srcA, srcB])

  // Smooth playhead updates at ~30 fps; waveform geometry is memoized separately.
  useEffect(() => {
    if (!playingA && !playingB) return
    let frame = 0
    let lastUpdate = 0
    const tick = (now: number) => {
      if (now - lastUpdate >= 33) {
        if (playingA && audioA.current) setTimeA(audioA.current.currentTime)
        if (playingB && audioB.current) setTimeB(audioB.current.currentTime)
        lastUpdate = now
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playingA, playingB])

  const updateBeatGridOffset = useCallback((id: string, delta: number) => {
    const current = tracks.find((item) => item.id === id)
    if (!current) return
    const updated: LocalTrack = { ...current, beatOffset: Math.max(-1, Math.min(1, (current.beatOffset ?? 0) + delta)), beatPeriod: current.beatPeriod ?? (current.bpm ? 60 / current.bpm : undefined) }
    setTracks((items) => items.map((item) => item.id === id ? updated : item))
    void addTracks([updated]).catch(() => setError('Не удалось сохранить поправку битгрида'))
  }, [tracks])

  const loadDeck = useCallback((which: 'A' | 'B', id: string) => {
    if (which === 'A') { setDeckA(id); setPicker(null) }
    else { setDeckB(id); setPicker(null) }
    setSyncFeedback('')
  }, [])

  function syncDeck(target: 'A' | 'B') {
    const source = target === 'A' ? audioB.current : audioA.current
    const destination = target === 'A' ? audioA.current : audioB.current
    const sourceTrack = target === 'A' ? loadedB : loadedA
    const targetTrack = target === 'A' ? loadedA : loadedB
    if (!source || !destination || !sourceTrack || !targetTrack) {
      setSyncFeedback('Загрузи трек в обе деки, чтобы синхронизировать такты.')
      return
    }
    if (!sourceTrack.bpm || !targetTrack.bpm) {
      setSyncFeedback('Для Sync нужен определённый BPM у обоих треков.')
      return
    }
    const sourceBeat = sourceTrack.beatPeriod ?? 60 / sourceTrack.bpm
    const targetBeat = targetTrack.beatPeriod ?? 60 / targetTrack.bpm
    const rate = targetBeat / sourceBeat
    if (rate < 0.5 || rate > 2) {
      setSyncFeedback('Разница BPM слишком большая для безопасной синхронизации (диапазон 0.5×–2×).')
      return
    }
    const sourceOffset = sourceTrack.beatOffset ?? 0
    const targetOffset = targetTrack.beatOffset ?? 0

    // Express the source playhead as a fraction of its detected beat, then
    // map that fraction onto the target's beat grid. This accounts for each
    // track's detected grid phase instead of assuming beat zero at time 0.
    const sourcePhaseSeconds = ((source.currentTime - sourceOffset) % sourceBeat + sourceBeat) % sourceBeat
    const beatProgress = sourcePhaseSeconds / sourceBeat
    // Choose the nearest target beat position that matches the source's current phase.
    // Subtract phase before rounding so we pick the closest valid alignment.
    const targetBeatIndex = Math.round((destination.currentTime - targetOffset) / targetBeat - beatProgress)
    const alignedTargetTime = targetOffset + (targetBeatIndex + beatProgress) * targetBeat

    destination.playbackRate = rate
    destination.currentTime = Math.max(0, Math.min(Number.isFinite(destination.duration) ? Math.max(0, destination.duration - 0.05) : alignedTargetTime, alignedTargetTime))
    setSyncRates((current) => ({ ...current, [target]: rate }))
    setSyncArmed((current) => ({ ...current, [target]: true }))
    setSyncFeedback(`Дека ${target} синхронизирована с декой ${target === 'A' ? 'B' : 'A'} · сетка учтена · ${sourceTrack.bpm} BPM · скорость ${rate.toFixed(3)}×`)
  }

  async function togglePlay(which: 'A' | 'B') {
    const audio = which === 'A' ? audioA.current : audioB.current
    const source = which === 'A' ? srcA : srcB
    if (!audio || !source) { setError('Сначала добавь трек и загрузи его в дек'); return }
    if (!audio.paused) { audio.pause(); return }
    // Re-align immediately before playback if Sync was pressed while this deck was paused.
    const otherAudio = which === 'A' ? audioB.current : audioA.current
    if (syncArmed[which] && otherAudio && !otherAudio.paused) syncDeck(which)
    const mix = crossfade / 100
    audio.volume = which === 'A' ? Math.cos(mix * Math.PI / 2) : Math.sin(mix * Math.PI / 2)
    try { await audio.play(); setError('') } catch { setError(`Дека ${which}: браузер не смог запустить аудио. Проверь формат файла и громкость устройства.`) }
  }
  function seek(which: 'A' | 'B', value: number) {
    const audio = which === 'A' ? audioA.current : audioB.current
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = value
  }
  async function importFiles(files: FileList | File[]) {
    const chosen = Array.from(files)
    if (!chosen.length) return
    setBusy(true); setError('')
    try {
      const accepted = chosen.filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|aiff?|ogg|flac|opus)$/i.test(file.name))
      if (!accepted.length) { setError('Выбери аудиофайл'); return }
      const records = await Promise.all(accepted.map(async (file) => ({
        id: makeId(), name: file.name, type: file.type || 'audio/unknown', size: file.size,
        duration: await readDuration(file), addedAt: Date.now(), blob: file, bpmStatus: 'pending' as const,
      })))
      await addTracks(records)
      const updated = await getTracks()
      setTracks(updated)
      if (!deckA && records[0]) setDeckA(records[0].id)
      else if (!deckB && records[0]) setDeckB(records[0].id)
    } catch { setError('Не удалось добавить файлы. Проверь свободное место на устройстве.') }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }
  async function removeTrack(track: LocalTrack) {
    try {
      await deleteTrack(track.id); await refresh()
      if (deckA === track.id) setDeckA(null)
      if (deckB === track.id) setDeckB(null)
    } catch { setError('Не удалось удалить трек') }
  }
  async function loadTelegram() {
    setTelegramOpen(true); setTelegramBusy(true); setError('')
    try {
      const response = await fetch('/api/telegram/tracks', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Telegram не настроен')
      setTelegramTracks(Array.isArray(data.tracks) ? data.tracks : [])
      setTelegramMaxUpdateId(typeof data.maxUpdateId === 'number' ? data.maxUpdateId : null)
      setTelegramDiagnostics(data.diagnostics && typeof data.diagnostics === 'object' ? data.diagnostics : null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подключиться к Telegram') }
    finally { setTelegramBusy(false) }
  }
  async function importTelegramTrack(item: TelegramTrack, targetDeck?: 'A' | 'B') {
    setTelegramBusy(true); setError('')
    setDownloadProgress({ fileId: item.fileId, loaded: 0, total: item.size || 0, stage: 'downloading' })
    try {
      const existing = tracks.find((saved) => saved.externalId === item.fileId)
      if (existing) {
        if (targetDeck === 'A') setDeckA(existing.id)
        else if (targetDeck === 'B') setDeckB(existing.id)

        setTelegramBusy(false)
        setDownloadProgress(null)
        return
      }

      const response = await fetch('/api/telegram/audio?fileId=' + encodeURIComponent(item.fileId), { cache: 'no-store' })
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Не удалось получить аудиофайл из Telegram') }
      const total = Number(response.headers.get('content-length') || item.size || 0)
      let blob: Blob
      if (response.body) {
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let loaded = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            loaded += value.byteLength
            setDownloadProgress({ fileId: item.fileId, loaded, total, stage: 'downloading' })
          }
        }
        blob = new Blob(chunks as unknown as BlobPart[], { type: response.headers.get('content-type') || item.type || 'audio/mpeg' })
      } else {
        blob = await response.blob()
        setDownloadProgress({ fileId: item.fileId, loaded: blob.size, total: blob.size, stage: 'downloading' })
      }

      setDownloadProgress({ fileId: item.fileId, loaded: blob.size, total: blob.size || total, stage: 'saving' })
      const record: LocalTrack = { id: makeId(), name: item.name || 'Telegram audio', type: item.type || blob.type || 'audio/mpeg', size: blob.size, duration: item.duration, addedAt: Date.now(), blob, externalId: item.fileId, sourceUpdateId: item.updateId, bpmStatus: 'pending' }
      await addTracks([record])
      const updated = await getTracks(); setTracks(updated)
      if (targetDeck === 'A') setDeckA(record.id)
      else if (targetDeck === 'B') setDeckB(record.id)


      const remaining = telegramTracks.filter((track) => track.fileId !== item.fileId && !updated.some((saved) => saved.externalId === track.fileId))
      if (remaining.length === 0 && telegramMaxUpdateId !== null) {
        await fetch('/api/telegram/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset: telegramMaxUpdateId + 1 }) })
        setTelegramMaxUpdateId(null)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось импортировать трек') }
    finally { setTelegramBusy(false); setDownloadProgress(null) }
  }
  async function install() {
    if (installPrompt) { await installPrompt.prompt(); setInstallPrompt(null) }
    else { setError('Добавь приложение на экран «Домой» через меню браузера.') }
  }

  return <main className="app-shell">
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="not-a-daw"><span className="brand-mark">n</span><span>not-a-daw</span></a>
      <div className="top-actions">
        <button className="icon-button" aria-label="Добавить треки" onClick={() => fileInput.current?.click()} disabled={busy}>＋</button>
        <button className="icon-button" aria-label="Установить приложение" onClick={() => void install()}>⇩</button>
      </div>
    </header>
    <input ref={fileInput} className="visually-hidden" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.aiff,.aif,.ogg,.flac,.opus" multiple onChange={(event) => { if (event.target.files) void importFiles(event.target.files) }} />
    <audio ref={audioA} src={srcA || undefined} preload="metadata" onTimeUpdate={() => { if (audioA.current) setTimeA(audioA.current.currentTime) }} onLoadedMetadata={() => { if (audioA.current) setDurationA(audioA.current.duration) }} onPlay={() => setPlayingA(true)} onPause={() => setPlayingA(false)} onEnded={() => setPlayingA(false)} onError={() => setError("Дека A: браузер не смог декодировать этот аудиофайл.")} />
    <audio ref={audioB} src={srcB || undefined} preload="metadata" onTimeUpdate={() => { if (audioB.current) setTimeB(audioB.current.currentTime) }} onLoadedMetadata={() => { if (audioB.current) setDurationB(audioB.current.duration) }} onPlay={() => setPlayingB(true)} onPause={() => setPlayingB(false)} onEnded={() => setPlayingB(false)} onError={() => setError("Дека B: браузер не смог декодировать этот аудиофайл.")} />

    <section className="decks" aria-label="Деки">
      <Deck letter="A" track={loadedA} tracks={tracks} onLoad={(id) => loadDeck('A', id)} onImport={() => fileInput.current?.click()} choosing={picker === 'A'} setChoosing={(v) => setPicker(v ? 'A' : null)} playing={playingA} time={timeA} duration={durationA} onPlay={() => void togglePlay('A')} onSeek={(v) => seek('A', v)} onStop={(anchor) => { if (audioA.current) { audioA.current.pause(); audioA.current.currentTime = anchor; setTimeA(anchor) } }} onSync={() => syncDeck('A')} onGridNudge={(delta) => loadedA && updateBeatGridOffset(loadedA.id, delta)} syncRate={syncRates.A} />
      <Deck letter="B" track={loadedB} tracks={tracks} onLoad={(id) => loadDeck('B', id)} onImport={() => fileInput.current?.click()} choosing={picker === 'B'} setChoosing={(v) => setPicker(v ? 'B' : null)} playing={playingB} time={timeB} duration={durationB} onPlay={() => void togglePlay('B')} onSeek={(v) => seek('B', v)} onStop={(anchor) => { if (audioB.current) { audioB.current.pause(); audioB.current.currentTime = anchor; setTimeB(anchor) } }} onSync={() => syncDeck('B')} onGridNudge={(delta) => loadedB && updateBeatGridOffset(loadedB.id, delta)} syncRate={syncRates.B} />
    </section>

    {syncFeedback && <p className="sync-feedback" role="status">{syncFeedback}<button aria-label="Закрыть сообщение Sync" onClick={() => setSyncFeedback('')}>×</button></p>}
    <section className="mixer" aria-label="Микшер">
      <div className="mixer-top"><span className="mixer-deck-a">A</span><span className="master-dot" /><span className="mixer-deck-b">B</span></div>
      <div className="crossfader-wrap">
        <span>A</span><input aria-label="Кроссфейдер" type="range" min="0" max="100" value={crossfade} onChange={(e) => setCrossfade(Number(e.target.value))} style={{'--mix-position': `${crossfade}%`} as CSSProperties} /><span>B</span>
      </div>
      <div className="mixer-bottom"><span>MASTER</span><span>{Math.round((audioA.current?.volume ?? 0) * 100)} / {Math.round((audioB.current?.volume ?? 0) * 100)}</span></div>
    </section>

    <section className="library-section" aria-label="Библиотека">
      <div className="library-heading"><h2>♫</h2><span className="track-count">{tracks.length}</span><button className="icon-button add-library" aria-label="Добавить треки" onClick={() => fileInput.current?.click()} disabled={busy}>＋</button><button className="telegram-link" onClick={() => telegramOpen ? setTelegramOpen(false) : void loadTelegram()} aria-label="Импортировать из Telegram" disabled={telegramBusy}>✈ <span>Telegram</span></button></div>
      {telegramOpen && <div className="telegram-feed">
        <div className="telegram-feed-head"><span>TELEGRAM · ЛИЧНЫЙ ЧАТ С БОТОМ</span><button aria-label="Закрыть Telegram" onClick={() => setTelegramOpen(false)}>×</button></div>
        {telegramBusy && !downloadProgress && <div className="loading-line" />}
        {!telegramBusy && telegramTracks.length === 0 && <div className="telegram-feed-empty">Новых аудиофайлов нет. {telegramDiagnostics ? `Бот: @${telegramDiagnostics.botUsername || 'не определён'}; webhook: ${telegramDiagnostics.webhookEnabled ? 'включён' : 'выключен'}; ожидают в очереди: ${telegramDiagnostics.webhookPendingCount}; обновлений — ${telegramDiagnostics.pendingUpdates}; личных сообщений — ${telegramDiagnostics.privateMessages}; распознанных аудиофайлов — ${telegramDiagnostics.recognizedAudioFiles}.` : ''} Отправь MP3 прямо в личный чат с ботом как аудио или файл, затем обнови список.</div>}
        {telegramTracks.map((item) => {
          const saved = tracks.find((track) => track.externalId === item.fileId)
          const onA = Boolean(saved && deckA === saved.id)
          const onB = Boolean(saved && deckB === saved.id)
          const progress = downloadProgress?.fileId === item.fileId ? downloadProgress : null
          return <div className={`telegram-feed-row ${onA ? 'loaded-on-a' : ''} ${onB ? 'loaded-on-b' : ''}`} key={item.fileId}>
            <div className="telegram-track-info"><strong title={item.name}>{item.name}</strong><span className="telegram-bitrate">{formatBitrate(item.size, item.duration)}</span>
              {progress && <div className="download-progress"><div className="download-progress-label"><span>{progress.stage === 'saving' ? 'Сохранение в библиотеку…' : 'Скачивание из Telegram…'}</span><span>{progress.total ? `${Math.min(100, Math.round(progress.loaded / progress.total * 100))}%` : formatBytes(progress.loaded)}</span></div><div className="download-progress-track"><i style={{ width: progress.stage === 'saving' ? '100%' : progress.total ? `${Math.min(100, progress.loaded / progress.total * 100)}%` : '35%' }} /></div><span className="download-progress-size">{formatBytes(progress.loaded)} / {progress.total ? formatBytes(progress.total) : 'размер неизвестен'}</span></div>}
            </div>
            <button aria-label={`Скачать ${item.name} в библиотеку`} onClick={() => void importTelegramTrack(item)} disabled={telegramBusy}>↓</button>
          </div>
        })}
        <div className="telegram-feed-empty"><a href="https://t.me/notadawbot" target="_blank" rel="noreferrer">Открыть чат с ботом ↗</a></div>
      </div>}
      {error && <p className="error-note" role="alert">{error}<button aria-label="Закрыть" onClick={() => setError('')}>×</button></p>}
      {busy && <div className="loading-line" />}
      {tracks.length === 0 ? <button className="empty-library" onClick={() => fileInput.current?.click()} disabled={busy}><span>＋</span></button> :
        <div className="track-list">{tracks.map((track) => <div className={`track-row-shell ${swipedTrackId === track.id ? 'open' : ''}`} key={track.id}>
          <div className="track-row-actions">
            <button type="button" className="track-info-action" aria-label={`Информация о треке ${track.name}`} title="Информация о треке" onClick={(event) => { event.stopPropagation(); setDetailTrackId(track.id); setSwipedTrackId(null) }}>⚙</button>
            <button className="trash-action" aria-label={`Удалить ${track.name}`} title="Удалить трек" onClick={() => { void removeTrack(track); setSwipedTrackId(null) }}>🗑</button>
          </div>
          <article className={`track-row ${deckA === track.id ? 'loaded-on-a' : ''} ${deckB === track.id ? 'loaded-on-b' : ''} ${swipedTrackId === track.id ? 'swiped' : ''}`}
            onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null }}
            onTouchEnd={(event) => { const startX = touchStartX.current; const endX = event.changedTouches[0]?.clientX; if (startX !== null && endX !== undefined) { if (endX - startX > 40) setSwipedTrackId(track.id); else if (startX - endX > 40 && swipedTrackId === track.id) setSwipedTrackId(null) } touchStartX.current = null }}
            onMouseDown={(event) => { touchStartX.current = event.clientX }}
            onMouseUp={(event) => { const startX = touchStartX.current; if (startX !== null && event.clientX - startX > 40) setSwipedTrackId(track.id); else if (startX !== null && startX - event.clientX > 40 && swipedTrackId === track.id) setSwipedTrackId(null); touchStartX.current = null }}>
            <span className="track-symbol">♫</span><div className="track-details"><strong title={track.name}>{track.name}</strong><span className="track-meta-line">{formatDuration(track.duration)} · {formatBytes(track.size)} · {formatBitrate(track.size, track.duration)} · <b className="track-bpm">BPM {track.bpm ?? (track.bpmStatus === 'pending' ? 'АНАЛИЗ…' : '—')}</b>{!track.bpm && track.bpmStatus === 'unavailable' && <button className="bpm-retry" onClick={() => { bpmAttempted.current.delete(track.id); const retry = { ...track, bpmStatus: 'pending' as const }; void addTracks([retry]).then(() => setTracks((current) => current.map((item) => item.id === track.id ? retry : item))).catch(() => setError('Не удалось повторить анализ BPM')) }}>↻</button>}</span></div>
            <button className={`mini-button ${deckA === track.id ? 'active-a' : ''}`} aria-label={`В дек A: ${track.name}`} onClick={() => setDeckA(track.id)}>A</button><button className={`mini-button mini-b ${deckB === track.id ? 'active-b' : ''}`} aria-label={`В дек B: ${track.name}`} onClick={() => setDeckB(track.id)}>B</button>
          </article>
        </div>)}</div>}
    </section>
    {detailTrack && <div className="track-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailTrackId(null) }}>
      <section className="track-detail-panel" role="dialog" aria-modal="true" aria-labelledby="track-detail-title">
        <div className="track-detail-header"><span className="track-detail-icon">♫</span><div><span className="track-detail-eyebrow">TRACK DETAILS</span><h2 id="track-detail-title">{detailTrack.name}</h2></div><button className="track-detail-close" aria-label="Закрыть информацию о треке" onClick={() => setDetailTrackId(null)}>×</button></div>
        <div className="track-detail-stats">
          <div><span>BPM</span><strong>{detailTrack.bpm ?? (detailTrack.bpmStatus === 'pending' ? 'Анализ…' : '—')}</strong></div>
          <div><span>ДЛИТЕЛЬНОСТЬ</span><strong>{formatDuration(detailTrack.duration)}</strong></div>
          <div><span>РАЗМЕР</span><strong>{formatBytes(detailTrack.size)}</strong></div>
          <div><span>БИТРЕЙТ</span><strong>{formatBitrate(detailTrack.size, detailTrack.duration)}</strong></div>
        </div>
        <div className="track-detail-meta"><span>Формат</span><strong>{detailTrack.type.replace('audio/', '').toUpperCase() || '—'}</strong></div>
        <div className="track-detail-meta"><span>Добавлен</span><strong>{new Date(detailTrack.addedAt).toLocaleDateString()}</strong></div>
        <div className="track-detail-actions"><button onClick={() => { setDeckA(detailTrack.id); setDetailTrackId(null) }}>Загрузить в A</button><button onClick={() => { setDeckB(detailTrack.id); setDetailTrackId(null) }}>Загрузить в B</button></div>
      </section>
    </div>}
    <footer><span className="wordmark"><span className="brand-mark">n</span><span>not-a-daw</span></span><span className="local-indicator"><i /> LOCAL</span></footer>
  </main>
}

function Deck({ letter, track, tracks, onLoad, onImport, choosing, setChoosing, playing, time, duration, onPlay, onSeek, onStop, onSync, onGridNudge, syncRate }: { letter: 'A' | 'B'; track?: LocalTrack; tracks: LocalTrack[]; onLoad: (id: string) => void; onImport: () => void; choosing: boolean; setChoosing: (value: boolean) => void; playing: boolean; time: number; duration: number; onPlay: () => void; onSeek: (value: number) => void; onStop: (anchor: number) => void; onSync: () => void; onGridNudge: (delta: number) => void; syncRate: number }) {
  const [waveformPeaks, setWaveformPeaks] = useState<WaveformPyramid | null>(null)
  const [zoom, setZoom] = useState(18)
  const [anchorTime, setAnchorTime] = useState(0)
  const [gridNudge, setGridNudge] = useState(0)
  const [titleOverflows, setTitleOverflows] = useState(false)
  const [titleScrollDistance, setTitleScrollDistance] = useState(0)
  const titleViewportRef = useRef<HTMLDivElement>(null)
  const titleTextRef = useRef<HTMLSpanElement>(null)
  const dragRef = useRef<{ x: number; time: number; pointerId: number } | null>(null)
  useEffect(() => {
    const viewport = titleViewportRef.current
    const title = titleTextRef.current
    if (!viewport || !title) { setTitleOverflows(false); setTitleScrollDistance(0); return }
    const measure = () => {
      const distance = Math.max(0, title.scrollWidth - viewport.clientWidth)
      setTitleScrollDistance(distance)
      setTitleOverflows(distance > 1)
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(viewport)
    observer?.observe(title)
    return () => observer?.disconnect()
  }, [track?.id, track?.name])
  useEffect(() => {
    let active = true
    setWaveformPeaks(null)
    if (track?.blob) {
      void getWaveformPeaks(track.blob).then((peaks) => {
        if (active) setWaveformPeaks(peaks)
      }).catch(() => {
        if (active) setWaveformPeaks(null)
      })
    }
    return () => { active = false }
  }, [track?.id, track?.blob])
  useEffect(() => { setZoom(18); setAnchorTime(0); setGridNudge(0) }, [track?.id])
  const beatPeriod = track?.beatPeriod ?? (track?.bpm ? 60 / track.bpm : undefined)
  const beatCount = beatPeriod && duration > 0 ? Math.floor(duration / beatPeriod) : 0
  const gridStride = Math.max(1, Math.ceil(beatCount / 1600))
  const gridLines = useMemo(() => track?.bpm && duration > 0 ? Array.from({ length: Math.floor(beatCount / gridStride) + 1 }, (_, i) => {
    const beat = i * gridStride
    const beatTime = (track.beatOffset ?? 0) + gridNudge + beat * (track.beatPeriod ?? 60 / track.bpm!)
    return <i key={beat} className={beat % 4 === 0 ? 'waveform-barline' : ''} style={{ left: (beatTime * zoom) + 'px' }} />
  }) : [], [track?.bpm, track?.beatPeriod, track?.beatOffset, gridNudge, duration, beatCount, gridStride, zoom])
  const contentWidth = Math.max(duration * zoom, 1)
    const waveformStyle = { '--wave-content-width': `${contentWidth}px`, '--wave-offset': `calc(50% - ${time * zoom}px)` } as CSSProperties
  function beginWaveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!track || !duration) return
    dragRef.current = { x: event.clientX, time, pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  function moveWaveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextTime = drag.time - (event.clientX - drag.x) / zoom
    onSeek(Math.max(0, Math.min(duration, nextTime)))
    event.preventDefault()
  }
  function endWaveDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }
  return <article className={`deck deck-${letter.toLowerCase()}`}>
    <div className="deck-head">
      <span className="deck-letter">{letter}</span>
      <div className={`deck-track-title ${titleOverflows ? 'is-overflowing' : ''}`} ref={titleViewportRef} title={track?.name ?? '—'} style={{ '--title-scroll-distance': `${titleScrollDistance}px` } as CSSProperties}>
        <span className="deck-track-title-text" ref={titleTextRef}>{track?.name ?? '—'}</span>
        {titleOverflows && <span className="deck-track-title-copy" aria-hidden="true">{track?.name}</span>}
      </div>
      <span className="deck-time">{formatDuration(time)} / {formatDuration(duration || track?.duration)}</span>
      <button className="deck-menu" aria-label={`Выбрать трек для деки ${letter}`} onClick={() => tracks.length ? setChoosing(!choosing) : onImport()}>⋮</button>
    </div>
    <div className={`waveform wave-${letter.toLowerCase()}`} style={waveformStyle} aria-label={`Увеличенная волна ${letter}; текущая позиция по центру; свайп для перемотки`} role="slider" aria-valuemin={0} aria-valuemax={duration || 0} aria-valuenow={time} tabIndex={track ? 0 : -1}
      onPointerDown={beginWaveDrag} onPointerMove={moveWaveDrag} onPointerUp={endWaveDrag} onPointerCancel={endWaveDrag}
      onKeyDown={(event) => { if (event.key === 'ArrowLeft') onSeek(Math.max(0, time - 0.1)); if (event.key === 'ArrowRight') onSeek(Math.min(duration, time + 0.1)) }}>
      <div className="waveform-content" style={{ width: `${contentWidth}px`, left: `calc(50% - ${time * zoom}px)` }}>
        <div className="waveform-grid" aria-hidden="true">{gridLines}</div>
      </div>
      <WaveformCanvas waveform={waveformPeaks} time={time} zoom={zoom} duration={duration || track?.duration || 0} />
      {!waveformPeaks && <span className="waveform-loading">{track ? 'ЗАГРУЗКА ВОЛНЫ…' : 'ЗАГРУЗИ ТРЕК'}</span>}
      <div className="waveform-anchor-line" style={{ left: `calc(50% + ${(anchorTime - time) * zoom}px)` }} aria-label={`Якорь ${formatDuration(anchorTime)}`} title={`Якорь ${formatDuration(anchorTime)}`} />
      <div className="waveform-center-line" aria-hidden="true" />
    </div>
    <div className="waveform-caption"><span>CUE {formatDuration(anchorTime)}</span><div className="waveform-zoom"><button type="button" aria-label="Уменьшить масштаб волны" disabled={zoom <= 6} onClick={() => setZoom((value) => Math.max(6, value / 1.5))}>−</button><span>{(zoom / 18).toFixed(1)}×</span><button type="button" aria-label="Увеличить масштаб волны" disabled={zoom >= 72} onClick={() => setZoom((value) => Math.min(72, value * 1.5))}>+</button></div><div className="grid-adjust"><button type="button" aria-label="Сдвинуть сетку битов назад на 10 миллисекунд" title="Сетка −10 мс" disabled={!track?.bpm} onClick={() => { onGridNudge(-0.01); setGridNudge(0) }}>−</button><span title="Поправка сетки сохраняется в треке">GRID{track?.bpm ? ` · ${track.bpm}` : " · BPM —"}</span><button type="button" aria-label="Сдвинуть сетку битов вперёд на 10 миллисекунд" title="Сетка +10 мс" disabled={!track?.bpm} onClick={() => { onGridNudge(0.01); setGridNudge(0) }}>+</button></div></div>
    <div className="deck-meta"><span><b>{track?.bpm ?? '—'}</b> BPM</span><span><b>{syncRate.toFixed(2)}×</b> RATE</span></div>
    <div className="waveform-seek"><input aria-label={`Точная позиция трека ${letter}`} type="range" min={0} max={Math.max(duration || track?.duration || 0, 0.01)} step="0.01" value={Math.min(time, duration || track?.duration || time)} onChange={(event) => onSeek(Number(event.target.value))} disabled={!track} /><span>{formatDuration(time)}</span></div><div className="transport"><button aria-label={`Стоп: вернуться к якорю деки ${letter}`} title="Стоп · к якорю" onClick={() => onStop(anchorTime)}>■</button><button className="play-button" aria-label={playing ? `Пауза деки ${letter}` : `Воспроизвести деку ${letter}`} title={playing ? "Пауза" : "Воспроизвести"} onClick={onPlay} disabled={!track}>{playing ? "Ⅱ" : "▶"}</button><button aria-label={`Установить якорь деки ${letter} в текущей позиции`} title="Поставить якорь здесь" onClick={() => setAnchorTime(time)} disabled={!track}>⚑</button><button aria-label={`Выбрать трек для деки ${letter}`} onClick={() => tracks.length ? setChoosing(!choosing) : onImport()}>♫</button></div>
    <button className="sync-button" onClick={onSync} disabled={!track}>{`SYNC ${letter} ← ${letter === 'A' ? 'B' : 'A'}`}</button>
    {choosing && <div className="deck-picker">{tracks.map((item) => <button key={item.id} onClick={() => onLoad(item.id)}>{item.name}</button>)}</div>}
  </article>
}
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
