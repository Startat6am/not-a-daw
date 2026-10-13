import { useEffect, useState } from 'react'

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
    { label: 'Offline shell', value: 'After first production load', good: true },
  ]
}

export default function App() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installState, setInstallState] = useState('Use your browser menu to add this app to the Home Screen.')
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const capabilities = getCapabilities()

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setInstallState('Ready to install')
    }
    window.addEventListener('beforeinstallprompt', handlePrompt)
    return () => window.removeEventListener('beforeinstallprompt', handlePrompt)
  }, [])

  async function installApp() {
    if (!installPrompt) {
      setInstallState('On iPhone: open Share → Add to Home Screen. On Android: open the browser menu → Install app.')
      return
    }
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    setInstallState(choice.outcome === 'accepted' ? 'Install accepted' : 'Install dismissed')
    setInstallPrompt(null)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#" aria-label="not-a-daw home"><span className="brand-mark">n</span> not-a-daw</a>
        <span className="local-pill"><span className="status-dot" /> LOCAL-FIRST</span>
      </header>

      <section className="intro">
        <div className="eyebrow">MOBILE DJ STUDIO <span>•</span> BUILD 0.1</div>
        <h1>Your tracks.<br /><em>Your flow.</em></h1>
        <p className="intro-copy">A pocket-sized space to shape your own tracks into one seamless set. No uploads. Just you and the music.</p>
        <button className="primary-button" onClick={installApp}><span>＋</span> Add to Home Screen</button>
        <p className="install-note">{installState}</p>
      </section>

      <section className="deck-preview" aria-label="Preview of the DJ decks">
        <div className="section-heading">
          <div><span className="eyebrow">YOUR MIX</span><h2>Decks at a glance</h2></div>
          <span className="coming-soon">ENGINE IN PROGRESS</span>
        </div>
        <div className="decks">
          <article className="deck deck-a">
            <div className="deck-head"><span className="deck-letter">A</span><span className="deck-label">LEFT DECK</span><span className="deck-empty">EMPTY</span></div>
            <div className="track-title">Drop a feeling<span>Load your first track</span></div>
            <div className="waveform wave-a" aria-hidden="true">{Array.from({ length: 64 }, (_, i) => <i key={i} style={{ height: `${12 + Math.abs(Math.sin(i * 1.73) * Math.cos(i * 0.29)) * 72}%` }} />)}</div>
            <div className="deck-meta"><span> BPM <b>— —</b></span><span> KEY <b>—</b></span><span> TIME <b>00:00</b></span></div>
            <button className="load-button" onClick={() => setInstallState('Track import arrives in Milestone 2.')}>＋ Load track</button>
          </article>
          <article className="deck deck-b">
            <div className="deck-head"><span className="deck-letter">B</span><span className="deck-label">RIGHT DECK</span><span className="deck-empty">EMPTY</span></div>
            <div className="track-title">Meet the next one<span>Your next track goes here</span></div>
            <div className="waveform wave-b" aria-hidden="true">{Array.from({ length: 64 }, (_, i) => <i key={i} style={{ height: `${12 + Math.abs(Math.sin(i * 1.19 + 1) * Math.cos(i * 0.21)) * 72}%` }} />)}</div>
            <div className="deck-meta"><span> BPM <b>— —</b></span><span> KEY <b>—</b></span><span> TIME <b>00:00</b></span></div>
            <button className="load-button" onClick={() => setInstallState('Track import arrives in Milestone 2.')}>＋ Load track</button>
          </article>
        </div>
        <div className="mixer-preview">
          <div className="mixer-label"><span>MASTER MIX</span><span>PREVIEW ONLY</span></div>
          <div className="crossfader-track"><span>A</span><div className="crossfader"><i /></div><span>B</span></div>
          <p>Crossfader, EQ and beat sync will become interactive as the audio engine is built.</p>
        </div>
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
        {showDiagnostics && <div className="capability-list">{capabilities.map((item) => <div className="capability" key={item.label}><span>{item.label}</span><span className={item.good ? 'capability-good' : 'capability-warn'}>{item.value}</span></div>)}<p className="privacy-note">This panel checks browser capabilities only. It does not upload files or send diagnostics.</p></div>}
      </section>
      <footer><span className="wordmark"><span className="brand-mark">n</span> not-a-daw</span><span>MADE FOR THE MIX IN YOUR HEAD.</span></footer>
    </main>
  )
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}