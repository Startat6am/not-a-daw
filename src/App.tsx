import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { addTracks, deleteTrack, getTracks, type LocalTrack } from './lib/audioLibrary'

function formatDuration(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—:—'
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}
function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  const [telegramTracks, setTelegramTracks] = useState<TelegramTrack[]>([])
  const [telegramMaxUpdateId, setTelegramMaxUpdateId] = useState<number | null>(null)
  const [telegramOpen, setTelegramOpen] = useState(false)
  const [telegramBusy, setTelegramBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const audioA = useRef<HTMLAudioElement>(null)
  const audioB = useRef<HTMLAudioElement>(null)
  const loadedA = tracks.find((track) => track.id === deckA)
  const loadedB = tracks.find((track) => track.id === deckB)

  const refresh = useCallback(() => { getTracks().then(setTracks).catch(() => setError('Не удалось открыть библиотеку')) }, [])
  useEffect(() => {
    refresh()
    const handlePrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as BeforeInstallPromptEvent) }
    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('beforeinstallprompt', handlePrompt); window.removeEventListener('focus', refresh) }
  }, [refresh])

  useEffect(() => {
    if (!loadedA) { setSrcA(''); setTimeA(0); setDurationA(0); setPlayingA(false); if (audioA.current) audioA.current.pause(); return }
    const url = URL.createObjectURL(loadedA.blob)
    if (audioA.current) { audioA.current.pause(); audioA.current.currentTime = 0 }
    setTimeA(0); setPlayingA(false); setSrcA(url)
    return () => URL.revokeObjectURL(url)
  }, [loadedA])
  useEffect(() => {
    if (!loadedB) { setSrcB(''); setTimeB(0); setDurationB(0); setPlayingB(false); if (audioB.current) audioB.current.pause(); return }
    const url = URL.createObjectURL(loadedB.blob)
    if (audioB.current) { audioB.current.pause(); audioB.current.currentTime = 0 }
    setTimeB(0); setPlayingB(false); setSrcB(url)
    return () => URL.revokeObjectURL(url)
  }, [loadedB])
  useEffect(() => {
    const p = crossfade / 100
    if (audioA.current) audioA.current.volume = Math.cos(p * Math.PI / 2)
    if (audioB.current) audioB.current.volume = Math.sin(p * Math.PI / 2)
  }, [crossfade, srcA, srcB])

  async function togglePlay(which: 'A' | 'B') {
    const audio = which === 'A' ? audioA.current : audioB.current
    const source = which === 'A' ? srcA : srcB
    if (!audio || !source) { setError('Сначала добавь трек и загрузи его в дек'); return }
    if (!audio.paused) { audio.pause(); return }
    try { await audio.play(); setError('') } catch { setError('Не удалось воспроизвести файл. Попробуй MP3, WAV или M4A.') }
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
        duration: await readDuration(file), addedAt: Date.now(), blob: file,
      })))
      await addTracks(records)
      await refresh()
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
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подключиться к Telegram') }
    finally { setTelegramBusy(false) }
  }
  async function importTelegramTrack(item: TelegramTrack) {
    setTelegramBusy(true); setError('')
    try {
      const response = await fetch('/api/telegram/audio?fileId=' + encodeURIComponent(item.fileId))
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Не удалось получить аудиофайл из Telegram') }
      const blob = await response.blob()
      const record: LocalTrack = { id: makeId(), name: item.name || 'Telegram audio', type: item.type || blob.type || 'audio/mpeg', size: blob.size, duration: item.duration, addedAt: Date.now(), blob, externalId: item.fileId, sourceUpdateId: item.updateId }
      await addTracks([record])
      const updated = await getTracks(); setTracks(updated)
      setTelegramTracks((items) => items.filter((track) => track.fileId !== item.fileId))
      const remaining = telegramTracks.filter((track) => track.fileId !== item.fileId && !updated.some((saved) => saved.externalId === track.fileId))
      if (remaining.length === 0 && telegramMaxUpdateId !== null) { await fetch('/api/telegram/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offset: telegramMaxUpdateId + 1 }) }); setTelegramMaxUpdateId(null) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось импортировать трек') }
    finally { setTelegramBusy(false) }
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
    <audio ref={audioA} src={srcA || undefined} preload="metadata" onTimeUpdate={() => { if (audioA.current) setTimeA(audioA.current.currentTime) }} onLoadedMetadata={() => { if (audioA.current) setDurationA(audioA.current.duration) }} onPlay={() => setPlayingA(true)} onPause={() => setPlayingA(false)} onEnded={() => setPlayingA(false)} />
    <audio ref={audioB} src={srcB || undefined} preload="metadata" onTimeUpdate={() => { if (audioB.current) setTimeB(audioB.current.currentTime) }} onLoadedMetadata={() => { if (audioB.current) setDurationB(audioB.current.duration) }} onPlay={() => setPlayingB(true)} onPause={() => setPlayingB(false)} onEnded={() => setPlayingB(false)} />

    <section className="decks" aria-label="Деки">
      <Deck letter="A" track={loadedA} tracks={tracks} onLoad={setDeckA} onImport={() => fileInput.current?.click()} choosing={picker === 'A'} setChoosing={(v) => setPicker(v ? 'A' : null)} playing={playingA} time={timeA} duration={durationA} onPlay={() => void togglePlay('A')} onSeek={(v) => seek('A', v)} onStop={() => { if (audioA.current) { audioA.current.pause(); audioA.current.currentTime = 0 } }} />
      <Deck letter="B" track={loadedB} tracks={tracks} onLoad={setDeckB} onImport={() => fileInput.current?.click()} choosing={picker === 'B'} setChoosing={(v) => setPicker(v ? 'B' : null)} playing={playingB} time={timeB} duration={durationB} onPlay={() => void togglePlay('B')} onSeek={(v) => seek('B', v)} onStop={() => { if (audioB.current) { audioB.current.pause(); audioB.current.currentTime = 0 } }} />
    </section>

    <section className="mixer" aria-label="Микшер">
      <div className="mixer-top"><span className="mixer-deck-a">A</span><span className="master-dot" /><span className="mixer-deck-b">B</span></div>
      <div className="crossfader-wrap">
        <span>A</span><input aria-label="Кроссфейдер" type="range" min="0" max="100" value={crossfade} onChange={(e) => setCrossfade(Number(e.target.value))} style={{'--mix-position': `${crossfade}%`} as CSSProperties} /><span>B</span>
      </div>
      <div className="mixer-bottom"><span>MASTER</span><span>{Math.round((audioA.current?.volume ?? 0) * 100)} / {Math.round((audioB.current?.volume ?? 0) * 100)}</span></div>
    </section>

    <section className="library-section" aria-label="Библиотека">
      <div className="library-heading"><h2>♫</h2><span className="track-count">{tracks.length}</span><button className="icon-button add-library" aria-label="Добавить треки" onClick={() => fileInput.current?.click()} disabled={busy}>＋</button><button className="telegram-link" onClick={() => telegramOpen ? setTelegramOpen(false) : void loadTelegram()} aria-label="Импортировать из Telegram" disabled={telegramBusy}>✈</button></div>
      {telegramOpen && <div className="telegram-feed">
        <div className="telegram-feed-head"><span>TELEGRAM · @dnb_selected</span><button aria-label="Закрыть Telegram" onClick={() => setTelegramOpen(false)}>×</button></div>
        {telegramBusy && <div className="loading-line" />}
        {!telegramBusy && telegramTracks.filter((item) => !tracks.some((saved) => saved.externalId === item.fileId)).length === 0 && <div className="telegram-feed-empty">Нет новых аудиотреков. Бот видит новые публикации только после подключения; старые посты Telegram Bot API не отдаёт.</div>}
        {telegramTracks.filter((item) => !tracks.some((saved) => saved.externalId === item.fileId)).map((item) => <div className="telegram-feed-row" key={item.fileId}><strong title={item.name}>{item.name}</strong><button onClick={() => void importTelegramTrack(item)} disabled={telegramBusy}>↓</button></div>)}
        <div className="telegram-feed-empty"><a href="https://t.me/dnb_selected" target="_blank" rel="noreferrer">Открыть канал ↗</a></div>
      </div>}
      {error && <p className="error-note" role="alert">{error}<button aria-label="Закрыть" onClick={() => setError('')}>×</button></p>}
      {busy && <div className="loading-line" />}
      {tracks.length === 0 ? <button className="empty-library" onClick={() => fileInput.current?.click()} disabled={busy}><span>＋</span></button> :
        <div className="track-list">{tracks.map((track) => <article className="track-row" key={track.id}>
          <span className="track-symbol">♫</span><div className="track-details"><strong title={track.name}>{track.name}</strong><span>{formatDuration(track.duration)} · {formatBytes(track.size)}</span></div>
          <button className="mini-button" aria-label={`В дек A: ${track.name}`} onClick={() => setDeckA(track.id)}>A</button><button className="mini-button mini-b" aria-label={`В дек B: ${track.name}`} onClick={() => setDeckB(track.id)}>B</button><button className="remove-button" aria-label={`Удалить ${track.name}`} onClick={() => void removeTrack(track)}>×</button>
        </article>)}</div>}
    </section>
    <footer><span className="wordmark"><span className="brand-mark">n</span><span>not-a-daw</span></span><span className="local-indicator"><i /> LOCAL</span></footer>
  </main>
}

function Deck({ letter, track, tracks, onLoad, onImport, choosing, setChoosing, playing, time, duration, onPlay, onSeek, onStop }: { letter: 'A' | 'B'; track?: LocalTrack; tracks: LocalTrack[]; onLoad: (id: string) => void; onImport: () => void; choosing: boolean; setChoosing: (value: boolean) => void; playing: boolean; time: number; duration: number; onPlay: () => void; onSeek: (value: number) => void; onStop: () => void }) {
  const progress = duration > 0 ? Math.min(100, time / duration * 100) : 0
  return <article className={`deck deck-${letter.toLowerCase()}`}>
    <div className="deck-head"><span className="deck-letter">{letter}</span><span className="deck-time">{formatDuration(time)} / {formatDuration(duration || track?.duration)}</span><button className="deck-menu" aria-label={`Выбрать трек для деки ${letter}`} onClick={() => tracks.length ? setChoosing(!choosing) : onImport()}>•••</button></div>
    <div className={`turntable ${playing ? 'is-playing' : ''}`}><div className="vinyl"><div className="vinyl-grooves" /><div className="vinyl-label">{letter}</div></div><div className="tonearm"><i /></div></div>
    <div className="deck-track">{track?.name ?? '—'}<span>{track ? formatBytes(track.size) : ' '}</span></div>
    <div className={`waveform wave-${letter.toLowerCase()}`} aria-label="Форма волны" role="img">{Array.from({ length: 56 }, (_, i) => <i key={i} style={{height:`${8 + Math.abs(Math.sin(i * (letter === 'A' ? 1.73 : 1.19) + (letter === 'A' ? 0 : 1)) * Math.cos(i * .29)) * 70}%`, opacity: i / 56 <= progress / 100 ? 1 : .48}} />)}</div>
    <input className="seek-bar" aria-label={`Позиция трека ${letter}`} type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={Math.min(time, Math.max(duration, 0.1))} onChange={(event) => onSeek(Number(event.target.value))} style={{'--seek-position': `${progress}%`} as CSSProperties} />
    <div className="deck-meta"><span><b>—</b> BPM</span><span><b>—</b> KEY</span></div>
    <div className="transport"><button aria-label={`Сбросить дек ${letter}`} onClick={onStop}>↶</button><button className="play-button" aria-label={playing ? 'Пауза' : 'Воспроизвести'} onClick={onPlay} disabled={!track}>{playing ? 'Ⅱ' : '▶'}</button><button aria-label={`Выбрать трек для деки ${letter}`} onClick={() => tracks.length ? setChoosing(!choosing) : onImport()}>♫</button></div>
    {choosing && <div className="deck-picker">{tracks.map((item) => <button key={item.id} onClick={() => { onLoad(item.id); setChoosing(false) }}>{item.name}</button>)}</div>}
  </article>
}
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
