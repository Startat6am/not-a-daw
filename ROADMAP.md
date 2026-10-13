# not-a-daw — Roadmap

Last updated: 2026-10-13

This file is the working product roadmap. Update checkboxes as work ships; Git commits remain the implementation history.

## Now — stability and library UX
- [x] Two-deck playback and basic mixer/crossfader.
- [x] Local audio library with saved tracks.
- [x] Import audio from a private Telegram chat with @notadawbot.
- [x] Show Telegram download progress and track file size/estimated bitrate.
- [x] Keep imported Telegram tracks in the library until the user chooses a deck.
- [x] Remove A/B quick-load buttons from Telegram rows; leave the download arrow.
- [x] Set Telegram download progress line to 1 px.
- [x] Verify on production that swipe-right reveals the gear and trash actions (user confirmed actions appear).
- [ ] Verify delete action removes the track and updates any deck currently using it.
- [ ] Add a visible, reliable way to close swipe actions (swipe-left and/or tap elsewhere).

## Next — DJ workflow
- [x] Confirm gear and trash actions appear on swipe.
- [ ] Verify and fix the gear action opening track details on touch devices.
- [x] Improve track selection and loading feedback for each deck (loaded-track confirmation and visible picker state).
- [ ] Verify BPM detection on imported files; detector updated and existing tracks will be re-analyzed.
- [ ] Add musical key detection, with graceful fallback when analysis is unavailable.
- [ ] Improve waveform usefulness and seek accuracy.
- [ ] Add BPM-based deck tempo sync and beat-phase alignment control (needs production verification).
- [ ] Add library search and sorting (name, duration, recently added) — intentionally deferred by user.

## Later — reliability and polish
- [ ] Test import/playback on mobile Safari and Android browsers with large files.
- [ ] Add clear empty, loading, and recoverable error states.
- [ ] Review offline/local-storage limits and give users a clear warning when storage is low.
- [ ] Add a basic end-to-end smoke-test checklist for production releases.

## Release checklist
- [ ] Latest Vercel production deployment is READY.
- [ ] Verify Telegram import -> library -> manual deck load -> playback.
- [ ] Verify swipe actions and deletion on a real phone.
- [ ] Verify both decks and crossfader still work after library changes.
