import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { addTracks, deleteTrack, getTracks, type LocalTrack } from './lib/audioLibrary'
import { detectBpm } from './lib/bpm'

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

const waveformCache = new WeakMap<Blob, Promise<number[]>>()
function getWaveformPeaks(blob: Blob, bars = 144): Promise<number[]> {
  const cached = waveformCache.get(blob)
  if (cached) return cached
  const task = (async () => {
    const scope = window as typeof window & { webkitAudioContext?: typeof AudioContext }
    const AudioContextClass = window.AudioContext || scope.webkitAudioContext
    if (!AudioContextClass || !blob.size) throw new Error('Waveform decoding unavailable')
    const context = new AudioContextClass()
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer())
      if (!buffer.length) throw new Error('Empty audio buffer')
      const peaks = new Array<number>(bars).fill(0)
      let globalPeak = 0
      for (let bin = 0; bin < bars; bin++) {
        const start = Math.floor(bin * buffer.length / bars)
        const end = Math.max(start + 1, Math.floor((bin + 1) * buffer.length / bars))
        let peak = 0
        for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
          const channel = buffer.getChannelData(channelIndex)
          for (let sampleIndex = start; sampleIndex < Math.min(end, buffer.length); sampleIndex++) {
            peak = Math.max(peak, Math.abs(channel[sampleIndex] || 0))
          }
        }
        peaks[bin] = peak
        globalPeak = Math.max(globalPeak, peak)
      }
      return peaks.map((peak) => globalPeak > 0 ? Math.max(0.035, Math.pow(peak / globalPeak, 0.68)) : 0.035)
    } finally {
      await context.close().catch(() => undefined)
    }
  })()
  waveformCache.set(blob, task)
  return task
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
  const [loadFeedbackA, setLoadFeedbackA] = useState('')
  const [loadFeedbackB, setLoadFeedbackB] = useState('')
  const [syncFeedback, setSyncFeedback] = useState('')
  const [syncRates, setSyncRates] = useState<{ A: number; B: number }>({ A: 1, B: 1 })
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
    if (!loadedA) { setSrcA(''); setTimeA(0); setDurationA(0); setPlayingA(false); if (audioA.current) { audioA.current.pause(); audioA.current.playbackRate = 1 }; setSyncRates((r) => ({ ...r, A: 1 })); return }
    const url = URL.createObjectURL(loadedA.blob)
    if (audioA.current) { audioA.current.pause(); audioA.current.currentTime = 0; audioA.current.playbackRate = 1 }
    setTimeA(0); setPlayingA(false); setSrcA(url); setLoadFeedbackA(`Загружено: ${loadedA.name}`); setSyncRates((r) => ({ ...r, A: 1 }))
    return () => URL.revokeObjectURL(url)
  }, [loadedA])
  useEffect(() => {
    if (!loadedB) { setSrcB(''); setTimeB(0); setDurationB(0); setPlayingB(false); if (audioB.current) { audioB.current.pause(); audioB.current.playbackRate = 1 }; setSyncRates((r) => ({ ...r, B: 1 })); return }
    const url = URL.createObjectURL(loadedB.blob)
    if (audioB.current) { audioB.current.pause(); audioB.current.currentTime = 0; audioB.current.playbackRate = 1 }
    setTimeB(0); setPlayingB(false); setSrcB(url); setLoadFeedbackB(`Загружено: ${loadedB.name}`); setSyncRates((r) => ({ ...r, B: 1 }))
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
    const p = crossfade / 100
    if (audioA.current) audioA.current.volume = Math.cos(p * Math.PI / 2)
    if (audioB.current) audioB.current.volume = Math.sin(p * Math.PI / 2)
  }, [crossfade, srcA, srcB])

  const loadDeck = useCallback((which: 'A' | 'B', id: string) => {
    if (which === 'A') { setDeckA(id); setLoadFeedbackA('Загрузка трека…'); setPicker(null) }
    else { setDeckB(id); setLoadFeedbackB('Загрузка трека…'); setPicker(null) }
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
    const rate = sourceTrack.bpm / targetTrack.bpm
    if (rate < 0.5 || rate > 2) {
      setSyncFeedback('Разница BPM слишком большая для безопасной синхронизации (диапазон 0.5×–2×).')
      return
    }
    const sourceBeat = 60 / sourceTrack.bpm
    const targetBeat = 60 / targetTrack.bpm
    const sourcePhase = source.currentTime % sourceBeat
    destination.playbackRate = rate
    destination.currentTime = Math.max(0, Math.floor(destination.currentTime / targetBeat) * targetBeat + sourcePhase * rate)
    setSyncRates((current) => ({ ...current, [target]: rate }))
    setSyncFeedback(`Дека ${target} синхронизирована с декой ${target === 'A' ? 'B' : 'A'} · ${sourceTrack.bpm} BPM · скорость ${rate.toFixed(3)}×`)
  }

  async function togglePlay(which: 'A' | 'B') {
    const audio = which === 'A' ? audioA.current : audioB.current
    const source = which === 'A' ? srcA : srcB
    if (!audio || !source) { setError('Сначала добавь трек и загрузи его в дек'); return }
    if (!audio.paused) { audio.pause(); return }
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
      <Deck letter="A" track={loadedA} tracks={tracks} onLoad={(id) => loadDeck('A', id)} onImport={() => fileInput.current?.click()} choosing={picker === 'A'} setChoosing={(v) => setPicker(v ? 'A' : null)} playing={playingA} time={timeA} duration={durationA} onPlay={() => void togglePlay('A')} onSeek={(v) => seek('A', v)} onStop={() => { if (audioA.current) { audioA.current.pause(); audioA.current.currentTime = 0 } }} onSync={() => syncDeck('A')} syncRate={syncRates.A} loadFeedback={loadFeedbackA} />
      <Deck letter="B" track={loadedB} tracks={tracks} onLoad={(id) => loadDeck('B', id)} onImport={() => fileInput.current?.click()} choosing={picker === 'B'} setChoosing={(v) => setPicker(v ? 'B' : null)} playing={playingB} time={timeB} duration={durationB} onPlay={() => void togglePlay('B')} onSeek={(v) => seek('B', v)} onStop={() => { if (audioB.current) { audioB.current.pause(); audioB.current.currentTime = 0 } }} onSync={() => syncDeck('B')} syncRate={syncRates.B} loadFeedback={loadFeedbackB} />
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

function Deck({ letter, track, tracks, onLoad, onImport, choosing, setChoosing, playing, time, duration, onPlay, onSeek, onStop, onSync, syncRate, loadFeedback }: { letter: 'A' | 'B'; track?: LocalTrack; tracks: LocalTrack[]; onLoad: (id: string) => void; onImport: () => void; choosing: boolean; setChoosing: (value: boolean) => void; playing: boolean; time: number; duration: number; onPlay: () => void; onSeek: (value: number) => void; onStop: () => void; onSync: () => void; syncRate: number; loadFeedback: string }) {
  const progress = duration > 0 ? Math.min(100, time / duration * 100) : 0
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>([])
  useEffect(() => {
    let active = true
    setWaveformPeaks([])
    if (track?.blob) {
      void getWaveformPeaks(track.blob).then((peaks) => {
        if (active) setWaveformPeaks(peaks)
      }).catch(() => {
        if (active) setWaveformPeaks([])
      })
    }
    return () => { active = false }
  }, [track?.id, track?.blob])
  const beatCount = track?.bpm && duration > 0 ? Math.floor(duration * track.bpm / 60) : 0
  const gridStride = Math.max(1, Math.ceil(beatCount / 240))
  return <article className={`deck deck-${letter.toLowerCase()}`}>
    <div className="deck-head"><span className="deck-letter">{letter}</span><span className="deck-time">{formatDuration(time)} / {formatDuration(duration || track?.duration)}</span><button className="deck-menu" aria-label={`Выбрать трек для деки ${letter}`} onClick={() => tracks.length ? setChoosing(!choosing) : onImport()}>•••</button></div>
    <div className={`turntable ${playing ? 'is-playing' : ''}`}><div className="vinyl"><div className="vinyl-grooves" /><div className="vinyl-label">{letter}</div></div><div className="tonearm"><i /></div></div>
    <div className="deck-track">{track?.name ?? '—'}<span>{track ? formatBytes(track.size) : ' '}</span></div>
    {loadFeedback && track && <div className="deck-load-feedback" title={loadFeedback}>{loadFeedback}</div>}
    <div className={`waveform wave-${letter.toLowerCase()}`} aria-label={`Реальная форма волны ${letter}${track?.bpm ? `, сетка ${track.bpm} BPM` : ''}`} role="img">
      <div className="waveform-grid" aria-hidden="true">{track?.bpm && duration > 0 && Array.from({ length: Math.floor(beatCount / gridStride) + 1 }, (_, i) => {
        const beat = i * gridStride
        return <i key={beat} className={beat % 4 === 0 ? 'waveform-barline' : ''} style={{ left: `${beat * 60 / track.bpm! / duration * 100}%` }} />
      })}</div>
      <div className="waveform-bars">{waveformPeaks.length ? waveformPeaks.map((peak, i) => <i key={i} style={{ height: `${Math.max(5, peak * 94)}%`, opacity: i / waveformPeaks.length <= progress / 100 ? 1 : .38 }} />) : <span className="waveform-loading">{track ? 'ЗАГРУЗКА ВОЛНЫ…' : 'ЗАГРУЗИ ТРЕК'}</span>}</div>
      <div className="waveform-playhead" style={{ left: `${progress}%` }} />
    </div>
    <div className="waveform-caption"><span>WAVEFORM</span><span>{track?.bpm ? `BEAT GRID · ${track.bpm} BPM` : 'BEAT GRID · BPM —'}</span></div>
    <input className="seek-bar" aria-label={`Позиция трека ${letter}`} type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={Math.min(time, Math.max(duration, 0.1))} onChange={(event) => onSeek(Number(event.target.value))} style={{'--seek-position': `${progress}%`} as CSSProperties} />
    <div className="deck-meta"><span><b>{track?.bpm ?? '—'}</b> BPM</span><span><b>{syncRate.toFixed(2)}×</b> RATE</span></div>
    <div className="transport"><button aria-label={`Сбросить дек ${letter}`} onClick={onStop}>↶</button><button className="play-button" aria-label={playing ? 'Пауза' : 'Воспроизвести'} onClick={onPlay} disabled={!track}>{playing ? 'Ⅱ' : '▶'}</button><button aria-label={`Выбрать трек для деки ${letter}`} onClick={() => tracks.length ? setChoosing(!choosing) : onImport()}>♫</button></div>
    <button className="sync-button" onClick={onSync} disabled={!track}>{`SYNC ${letter} ← ${letter === 'A' ? 'B' : 'A'}`}</button>
    {choosing && <div className="deck-picker">{tracks.map((item) => <button key={item.id} onClick={() => onLoad(item.id)}>{item.name}</button>)}</div>}
  </article>
}
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
