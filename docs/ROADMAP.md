# not-a-daw — product plan and roadmap

## Product goal

Build a mobile-browser DJ tool for creating smooth sets from the user's own tracks. It is a touch-first instrument, not a desktop DAW shrunk to phone size.

## Non-negotiable constraints

1. **Mobile browser first:** validate on real iOS Safari and Android Chrome early.
2. **Local-first:** audio files never leave the device. No server-side audio processing in v1.
3. **Incremental milestones:** keep the app runnable after each milestone.
4. **Graceful capability detection:** storage, codecs, audio routing, and background behavior differ across browsers.
5. **No false promises:** advanced time-stretching and MP3 export are technical risks; validate them before committing to a specific implementation.

## V1 scope

### Included
- Import supported audio files from the phone's file picker.
- Local persistence of imported audio and project data using IndexedDB and, where supported, OPFS.
- Waveform display, zoom, and touch seeking.
- BPM and beat-grid estimation with manual BPM adjustment, half/double tempo, and beat-grid offset.
- Two decks, A and B, with play/pause, cue/seek basics, crossfader, and independent three-band EQ.
- Sync for tempo alignment; pitch/key matching only if a reliable, performant browser implementation is validated.
- Set arrangement: track order, in/out points, 8/16/32-beat transitions, crossfade/bass-swap/filter transition types, and transition preview.
- Save/open project.
- Render a complete set to WAV. MP3 export only after a suitable client-side encoder and mobile performance are validated.
- Installable PWA app shell.

### Explicitly deferred
- Cloud sync, accounts, collaboration, social features, streaming catalogs, plugin hosting, full multitrack DAW editing, and server uploads.
- Guaranteed background playback on every mobile browser.
- Perfect automatic beat/key detection for every genre and recording.

## Proposed architecture

- **UI:** TypeScript, Vite, React; mobile-first component layout.
- **Audio runtime:** Web Audio API; separate audio engine module from UI state.
- **Persistence:** IndexedDB for project metadata and small records; OPFS for large binary assets when supported. Keep a tested IndexedDB fallback.
- **Analysis:** Web Worker for waveform summaries and BPM/beat-grid analysis where possible.
- **Rendering/export:** offline rendering pipeline where browser support allows; WAV PCM encoder first. MP3 encoder is a separately validated milestone.
- **PWA:** manifest, service worker, app-shell caching, capability and storage diagnostics.
- **Testing:** unit tests for timeline/beat math; browser tests for UI; real-device checklist for audio latency, storage, memory, and export.

## Milestones and acceptance criteria

### M0 — Product and repository baseline
- [x] Define product principles and v1 boundaries.
- [x] Document risks and milestone acceptance criteria.
- [ ] Agree on target browsers/devices and initial audio formats.
- **Exit:** scope is stable enough to implement.

### M1 — Runnable mobile PWA shell
- [ ] Create app scaffold, lint/typecheck/test scripts, and a minimal CI workflow.
- [ ] Add responsive layout, install manifest, and service worker.
- [ ] Add a capability/status panel for storage and audio support.
- [ ] Verify the app starts locally and builds for static hosting.
- **Exit:** installable shell loads on target phones and works offline for the app shell.

### M2 — Local library and persistence
- [ ] Import audio using the device file picker.
- [ ] Show library metadata (name, duration, file size where available).
- [ ] Persist audio locally and restore library after reload.
- [ ] Handle quota errors, unsupported formats, and deletion.
- [ ] Add a privacy/storage explanation and a project backup path.
- **Exit:** imported audio survives reload on tested devices without network upload.

### M3 — Single-deck playback and waveform
- [ ] Decode/play/pause/seek one local track.
- [ ] Render a waveform overview and detailed region.
- [ ] Implement touch seeking and zoom.
- [ ] Handle decode errors, large files, and audio-context resume gestures.
- **Exit:** one track is usable by touch on a phone.

### M4 — BPM and beat grid
- [ ] Implement initial BPM estimation and confidence reporting.
- [ ] Display beat grid over waveform.
- [ ] Manual BPM, ×2/÷2, and grid offset controls.
- [ ] Test half-time/double-time genres and low-confidence cases.
- **Exit:** user can correct detection and align beats manually.

### M5 — Two decks and live mixer
- [ ] Run two decks from local assets.
- [ ] Add crossfader, per-deck 3-band EQ, gain, and cue/seek basics.
- [ ] Prevent clipping where practical and show audio status.
- [ ] Test simultaneous playback and memory use on real phones.
- **Exit:** two tracks can be mixed live without UI stalls on target devices.

### M6 — Sync and transition engine
- [ ] Align beat phase and tempo between decks.
- [ ] Evaluate time-stretch options on mobile browsers before selecting an implementation.
- [ ] Implement transition definitions: crossfade, bass swap, filter; lengths of 8/16/32 beats.
- [ ] Add in/out points and transition preview.
- [ ] Key matching is optional and gated on a proven client-side implementation.
- **Exit:** common transitions sound acceptable and remain editable.

### M7 — Set editor and project format
- [ ] Arrange, reorder, and remove tracks.
- [ ] Save/load versioned project files.
- [ ] Store per-track cues, grid corrections, and transition settings.
- [ ] Handle missing source files and project migrations.
- **Exit:** a set can be closed and restored with its edits intact.

### M8 — Full-set render and export
- [ ] Render transitions into a continuous mix.
- [ ] Export WAV first with progress, cancellation, and memory safeguards.
- [ ] Validate MP3 encoder/license/quality/performance before adding MP3.
- [ ] Test short and long sets on target phones.
- **Exit:** exported file plays correctly outside the app.

### M9 — Hardening and release
- [ ] Accessibility and touch-target review.
- [ ] Offline/PWA update behavior and storage quota tests.
- [ ] Browser compatibility matrix and known limitations.
- [ ] Performance profiling, error handling, and release checklist.
- **Exit:** documented v1 release candidate.

## Working rules

- Work on one milestone at a time.
- Before coding each milestone, write its acceptance checklist and identify the riskiest unknown.
- Keep changes small and runnable; avoid large speculative rewrites.
- After each milestone: build, run tests, review mobile behavior, update this roadmap, and commit.
- Never claim a feature is complete until its acceptance criteria have been tested.
- Do not add audio upload or remote audio processing.

## Key technical risks to validate early

1. iOS Safari audio-context lifecycle and playback behavior.
2. Storage limits/eviction and OPFS availability across browsers.
3. Memory pressure when decoding long/high-resolution audio files.
4. Quality and CPU cost of real-time time-stretching on phones.
5. Offline rendering limits for long sets.
6. MP3 encoding support and licensing/implementation choice.
7. Whether key detection/key shifting is worth its performance cost in v1.

## Initial decisions to make before M1

- Minimum supported devices/browsers (recommended starting point: current iOS Safari and Android Chrome).
- First supported import formats (recommended: browser-decodable formats such as WAV, MP3, and M4A/AAC where supported; detect support rather than assuming).
- Whether to use React or a lighter UI framework (React is the default unless the repository owner prefers otherwise).
