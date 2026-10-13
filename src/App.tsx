import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { addTracks, deleteTrack, getTracks, type LocalTrack } from './lib/audioLibrary'

function formatDuration(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—:—'
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}
function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
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
  const fileInput = useRef<HTMLInputElement>(null)
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
  async function install() {
    if (installPrompt) { await installPrompt.prompt(); setInstallPrompt(null) }
    else { setError('iPhone: Поделиться → На экран «Домой». Android: меню браузера → Установить.') }
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

    <section className="decks" aria-label="Деки">
      <Deck letter="A" track={loadedA} tracks={tracks} onLoad={setDeckA} onImport={() => fileInput.current?.click()} choosing={picker === 'A'} setChoosing={(v) => setPicker(v ? 'A' : null)} />
      <Deck letter="B" track={loadedB} tracks={tracks} onLoad={setDeckB} onImport={() => fileInput.current?.click()} choosing={picker === 'B'} setChoosing={(v) => setPicker(v ? 'B' : null)} />
    </section>

    <section className="mixer" aria-label="Микшер">
      <div className="mixer-top"><span className="mixer-deck-a">A</span><span className="master-dot" /><span className="mixer-deck-b">B</span></div>
      <div className="crossfader-wrap">
        <span>A</span><input aria-label="Кроссфейдер" type="range" min="0" max="100" value={crossfade} onChange={(e) => setCrossfade(Number(e.target.value))} style={{'--mix-position': `${crossfade}%`} as CSSProperties} /><span>B</span>
      </div>
      <div className="mixer-bottom"><span>MASTER</span><span>— dB</span></div>
    </section>

    <section className="library-section" aria-label="Библиотека">
      <div className="library-heading"><h2>♫</h2><span className="track-count">{tracks.length}</span><button className="icon-button add-library" aria-label="Добавить треки" onClick={() => fileInput.current?.click()} disabled={busy}>＋</button></div>
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

function Deck({ letter, track, tracks, onLoad, onImport, choosing, setChoosing }: { letter: 'A' | 'B'; track?: LocalTrack; tracks: LocalTrack[]; onLoad: (id: string) => void; onImport: () => void; choosing: boolean; setChoosing: (value: boolean) => void }) {
  return <article className={`deck deck-${letter.toLowerCase()}`}>
    <div className="deck-head"><span className="deck-letter">{letter}</span><span className="deck-time">{formatDuration(track?.duration)}</span><button className="deck-menu" aria-label={`Выбрать трек для деки ${letter}`} onClick={() => tracks.length ? setChoosing(!choosing) : onImport()}>•••</button></div>
    <div className="turntable"><div className="vinyl"><div className="vinyl-grooves" /><div className="vinyl-label">{letter}</div></div><div className="tonearm"><i /></div></div>
    <div className="deck-track">{track?.name ?? '—'}<span>{track ? formatBytes(track.size) : ' '}</span></div>
    <div className={`waveform wave-${letter.toLowerCase()}`} aria-label="Форма волны" role="img">{Array.from({ length: 56 }, (_, i) => <i key={i} style={{height:`${8 + Math.abs(Math.sin(i * (letter === 'A' ? 1.73 : 1.19) + (letter === 'A' ? 0 : 1)) * Math.cos(i * .29)) * 70}%`}} />)}</div>
    <div className="deck-meta"><span><b>—</b> BPM</span><span><b>—</b> KEY</span></div>
    <div className="transport"><button aria-label="Назад" disabled>↶</button><button className="play-button" aria-label="Воспроизвести" disabled>▶</button><button aria-label="Вперёд" disabled>↷</button></div>
    {choosing && <div className="deck-picker">{tracks.map((item) => <button key={item.id} onClick={() => { onLoad(item.id); setChoosing(false) }}>{item.name}</button>)}</div>}
  </article>
}
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
