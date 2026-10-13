import { useEffect, useRef, useState } from 'react'
import { addTracks, deleteTrack, getTracks, type LocalTrack } from './lib/audioLibrary'

type Capability = { label: string; value: string; good: boolean }

function getCapabilities(): Capability[] {
  const supported = typeof window !== 'undefined'
  const storage = supported && 'storage' in navigator
  const audio = supported && ('AudioContext' in window || 'webkitAudioContext' in window)
  const opfs = storage && 'getDirectory' in (navigator.storage ?? {})
  const indexedDb = supported && 'indexedDB' in window
  return [
    { label: 'Web Audio', value: audio ? 'Available' : 'Not detected', good: audio },
    { label: 'IndexedDB', value: indexedDb ? 'Available' : 'Not detected', good: indexedDb },
    { label: 'OPFS', value: opfs ? 'Available' : 'Fallback needed', good: opfs },
    { label: 'Local audio library', value: indexedDb ? 'Ready' : 'Not detected', good: indexedDb },
  ]
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return '—:—'
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function App() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installState, setInstallState] = useState('Your tracks are stored in this browser on this device.')
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [tracks, setTracks] = useState<LocalTrack[]>([])
  const [deckA, setDeckA] = useState<string | null>(null)
  const [deckB, setDeckB] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const capabilities = getCapabilities()
  const loadedA = tracks.find((track) => track.id === deckA)
  const loadedB = tracks.find((track) => track.id === deckB)

  useEffect(() => {
    let active = true
    getTracks().then((saved) => { if (active) setTracks(saved) }).catch(() => {
      if (active) setLibraryError('Could not open local storage. Try a current version of Safari or Chrome.')
    })
    const handlePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setInstallState('Ready to install')
    }
    window.addEventListener('beforeinstallprompt', handlePrompt)
    return () => { active = false; window.removeEventListener('beforeinstallprompt', handlePrompt) }
  }, [])

  async function installApp() {
    if (!installPrompt) {
      setInstallState('iPhone: Share → Add to Home Screen. Android: browser menu → Install app.')
      return
    }
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setInstallState(choice.outcome === 'accepted' ? 'Install accepted' : 'Install dismissed')
    setInstallPrompt(null)
  }

  async function importFiles(files: FileList | File[]) {
    const chosen = Array.from(files)
    if (!chosen.length) return
    setBusy(true)
    setLibraryError('')
    try {
      const accepted = chosen.filter((file) => file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|aiff?|ogg|flac|opus)$/i.test(file.name))
      if (!accepted.length) {
        setLibraryError('No supported audio files found. Choose MP3, WAV, M4A, AAC, AIFF, OGG, FLAC or Opus files.')
        return
      }
      const records = await Promise.all(accepted.map(async (file) => {
        const duration = await readDuration(file)
        return { file, duration }
      }))
      await addTracks(records.map(({ file, duration }) => ({
        id: makeId(), name: file.name, type: file.type || 'audio/unknown',
        size: file.size, duration, addedAt: Date.now(), blob: file,
      })))
      setTracks(await getTracks())
      setInstallState(`Added ${records.length} track${records.length === 1 ? '' : 's'} to this device only.`)
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Import failed. Your browser may be out of storage space.')
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function removeTrack(track: LocalTrack) {
    try {
      await deleteTrack(track.id)
      setTracks(await getTracks())
      if (deckA === track.id) setDeckA(null)
      if (deckB === track.id) setDeckB(null)
      setInstallState('Track removed from this device.')
    } catch {
      setLibraryError('Could not remove this track from local storage.')
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#" aria-label="not-a-daw home"><span className="brand-mark">n</span> not-a-daw</a>
        <span className="local-pill"><span className="status-dot" /> LOCAL-FIRST</span>
      </header>

      <section className="intro">
        <div className="eyebrow">MOBILE DJ STUDIO <span>•</span> BUILD 0.2</div>
        <h1>Your tracks.<br /><em>Your flow.</em></h1>
        <p className="intro-copy">A pocket-sized space to shape your own tracks into one seamless set. No uploads. Just you and the music.</p>
        <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={busy}><span>＋</span> {busy ? 'Importing tracks…' : 'Import tracks'}</button>
        <input ref={fileInput} className="visually-hidden" type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.aiff,.aif,.ogg,.flac,.opus" multiple onChange={(event) => { if (event.target.files) void importFiles(event.target.files) }} />
        <button className="install-button" onClick={installApp}>Add to Home Screen</button>
        <p className="install-note">{installState}</p>
      </section>

      <section className="deck-preview" aria-label="DJ decks">
        <div className="section-heading">
          <div><span className="eyebrow">YOUR MIX</span><h2>Decks at a glance</h2></div>
          <span className="coming-soon">PLAYBACK NEXT</span>
        </div>
        <div className="decks">
          <Deck letter="A" track={loadedA} tracks={tracks} onLoad={setDeckA} onImport={() => fileInput.current?.click()} />
          <Deck letter="B" track={loadedB} tracks={tracks} onLoad={setDeckB} onImport={() => fileInput.current?.click()} />
        </div>
        <div className="mixer-preview">
          <div className="mixer-label"><span>MASTER MIX</span><span>PLAYBACK IN PROGRESS</span></div>
          <div className="crossfader-track"><span>A</span><div className="crossfader"><i /></div><span>B</span></div>
          <p>Next: audio playback, real waveforms and touch-friendly transport controls.</p>
        </div>
      </section>

      <section className="library-section">
        <div className="section-heading"><div><span className="eyebrow">ON THIS DEVICE</span><h2>Track library <span className="track-count">{tracks.length}</span></h2></div><button className="text-button" onClick={() => fileInput.current?.click()} disabled={busy}>＋ Add files</button></div>
        <p className="library-copy">Files are saved in this browser's private local database. They are not uploaded to a server.</p>
        {libraryError && <p className="error-note" role="alert">{libraryError}</p>}
        {tracks.length === 0 ? <div className="empty-library"><span className="empty-symbol">♫</span><strong>Your library is empty</strong><p>Import audio files from your phone to get started.</p><button className="load-button" onClick={() => fileInput.current?.click()} disabled={busy}>＋ Choose audio files</button></div> :
          <div className="track-list">{tracks.map((track) => <article className="track-row" key={track.id}><span className="track-symbol">♫</span><div className="track-details"><strong title={track.name}>{track.name}</strong><span>{formatDuration(track.duration)} · {formatBytes(track.size)}</span></div><button className="mini-button" aria-label={`Load ${track.name} into deck A`} onClick={() => setDeckA(track.id)}>A</button><button className="mini-button mini-b" aria-label={`Load ${track.name} into deck B`} onClick={() => setDeckB(track.id)}>B</button><button className="remove-button" aria-label={`Remove ${track.name}`} onClick={() => void removeTrack(track)}>×</button></article>)}</div>}
      </section>

      <section className="principles">
        <div className="section-heading"><div><span className="eyebrow">BUILT AROUND YOU</span><h2>Made for the phone in your hand.</h2></div></div>
        <div className="principle-grid">
          <article><span className="principle-icon">↗</span><h3>Your files stay yours.</h3><p>Audio is designed to stay on this device. No cloud library and no audio uploads.</p></article>
          <article><span className="principle-icon">⌁</span><h3>Touch comes first.</h3><p>Big controls and waveforms designed for fingers, not a mouse.</p></article>
          <article><span className="principle-icon">◷</span><h3>Build at your pace.</h3><p>Save a set locally and return to your ideas when inspiration hits.</p></article>
        </div>
      </section>

      <section className="diagnostics">
        <button className="diagnostics-toggle" onClick={() => setShowDiagnostics(!showDiagnostics)} aria-expanded={showDiagnostics}>
          <span><span className="status-dot" /> DEVICE READINESS</span><span>{showDiagnostics ? '−' : '+'}</span>
        </button>
        {showDiagnostics && <div className="capability-list">{capabilities.map((item) => <div className="capability" key={item.label}><span>{item.label}</span><span className={item.good ? 'capability-good' : 'capability-warn'}>{item.value}</span></div>)}<p className="privacy-note">Capability checks run in this browser. Audio files are not sent anywhere by this app.</p></div>}
      </section>
      <footer><span className="wordmark"><span className="brand-mark">n</span> not-a-daw</span><span>MADE FOR THE MIX IN YOUR HEAD.</span></footer>
    </main>
  )
}

function Deck({ letter, track, tracks, onLoad, onImport }: { letter: 'A' | 'B'; track?: LocalTrack; tracks: LocalTrack[]; onLoad: (id: string) => void; onImport: () => void }) {
  const [choosing, setChoosing] = useState(false)
  return <article className={`deck deck-${letter.toLowerCase()}`}>
    <div className="deck-head"><span className="deck-letter">{letter}</span><span className="deck-label">{letter === 'A' ? 'LEFT DECK' : 'RIGHT DECK'}</span><span className="deck-empty">{track ? 'LOADED' : 'EMPTY'}</span></div>
    <div className="track-title">{track ? track.name : letter === 'A' ? 'Drop a feeling' : 'Meet the next one'}<span>{track ? `${formatDuration(track.duration)} · ${formatBytes(track.size)} · ready for playback stage` : 'Load a track from your library'}</span></div>
    <div className={`waveform wave-${letter.toLowerCase()}`} aria-label="Waveform will be generated in the playback milestone" role="img">{Array.from({ length: 64 }, (_, i) => <i key={i} style={{ height: `${12 + Math.abs(Math.sin(i * (letter === 'A' ? 1.73 : 1.19) + (letter === 'A' ? 0 : 1)) * Math.cos(i * .29)) * 72}%` }} />)}</div>
    <div className="deck-meta"><span>BPM <b>— —</b></span><span>KEY <b>—</b></span><span>TIME <b>{formatDuration(track?.duration)}</b></span></div>
    <button className="load-button" onClick={() => tracks.length ? setChoosing(!choosing) : onImport()}>{choosing ? 'Close track picker' : track ? '↻ Change track' : '＋ Load track'}</button>
    {choosing && <div className="deck-picker">{tracks.map((item) => <button key={item.id} onClick={() => { onLoad(item.id); setChoosing(false) }}>{item.name}</button>)}</div>}
  </article>
}

function makeId() {
  return `track-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

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

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}
