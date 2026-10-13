# not-a-daw

A mobile-first, local-first DJ set builder for your own audio files. Designed to run in a mobile browser and install as a PWA.

## Product principles

- **Local-first audio:** source audio stays on the device; no audio upload or server-side processing.
- **Phone-first UX:** touch targets, responsive layout, and usable controls on a small screen.
- **Incremental delivery:** every milestone should leave the project in a runnable state.
- **Honest compatibility:** browser audio, storage quotas, background playback, and export capabilities vary by device/browser.

## Current status

Project planning. See [the roadmap](docs/ROADMAP.md) for scope, milestones, architecture, and acceptance criteria.

## Planned technology

- TypeScript + Vite
- React for the interface
- Web Audio API for playback and mixing
- IndexedDB for project metadata and audio-file records; OPFS where supported and useful for large local assets
- Web Workers for CPU-heavy analysis where supported
- PWA manifest and service worker for installation and app-shell caching

The stack can be revisited during the architecture milestone before implementation begins.

## Privacy

The initial product has no account, no analytics requirement, and no audio upload endpoint. Imported audio and project data are stored locally in the browser's storage area. Browser storage can be cleared by the user or evicted by the browser, so export/backup of project metadata will be important.

## Development

Development setup will be added in Milestone 1.
