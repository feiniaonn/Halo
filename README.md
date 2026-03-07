# Halo

Halo is a Windows desktop media toolbox built with Tauri 2, React 19, TypeScript, and Rust. It focuses on local desktop playback and source management for personal media workflows, including live streams, VOD source import/parsing, music control, lyrics retrieval, mini-player mode, and desktop-oriented settings.

## Open Source Status

This repository is maintained as a public open-source project.

- The repository source code is published under the MIT License. See [LICENSE](./LICENSE).
- Third-party dependencies, bundled resources, and compatibility artifacts keep their own licenses or upstream terms where applicable.
- If a file or resource comes from an external project, its original source and licensing should be preserved or recorded in this repository before redistribution.

A detailed attribution and provenance note is available in [docs/OPEN_SOURCE_NOTICE.md](./docs/OPEN_SOURCE_NOTICE.md).

## What The Project Contains

Halo currently includes these major areas:

- Desktop shell and UI built with Tauri + React.
- Media source management for live/VOD workflows.
- TVBox-like configuration import, parsing, and compatibility helpers.
- Video playback helpers for HLS, FLV, MPEG-TS, DASH, and direct media links.
- Music control, lyrics providers, and mini-player interaction.
- Windows-specific integrations such as tray, global shortcuts, autostart, updater hooks, and system/media controls.
- Research and compatibility notes under `docs/` for media source formats and parsing behavior.

## Repository Structure

- `src/`: React UI, pages, and front-end modules.
- `src-tauri/src/`: Rust backend commands, media services, settings, updater, compatibility helpers, and music/media subsystems.
- `src-tauri/resources/`: Runtime resources bundled with the desktop app.
- `docs/`: project notes, parsing research, and source-format documentation.
- `scripts/`: build and packaging scripts.
- `tools/`: local development helpers.

## Main Capabilities

- Import or manage media source configurations.
- Browse live/VOD related pages and player windows.
- Handle source parsing and network compatibility rules.
- Run a floating or mini player workflow on desktop.
- Control music playback and retrieve lyrics from supported providers.
- Configure updater endpoints, background assets, startup behavior, and shortcut preferences.

## Development Stack

- Frontend: React, TypeScript, Vite.
- Desktop runtime: Tauri 2.
- Backend: Rust.
- Playback/network ecosystem: hls.js, flv.js, dash.js, mpegts.js, mpv-related integration, and custom Rust media helpers.

## Local Development

Requirements:

- Node.js / pnpm
- Rust toolchain
- Tauri prerequisites for Windows

Common commands:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm tauri dev
```

## Open Source, Compliance, and Content Boundary

Halo is an application framework and compatibility project. The repository does not claim ownership of third-party media content, streaming endpoints, or upstream site data.

Please pay attention to the following:

- Do not use this project to distribute media content without authorization.
- User-imported source lists, remote endpoints, and third-party site configurations must be used only when you have the legal right to access and process them.
- If you redistribute this repository publicly, keep attribution information intact and add provenance for any newly introduced third-party code, assets, or jars.
- Before publishing bundled third-party artifacts, verify that redistribution is allowed by their upstream licenses.

## Inspiration and Referenced Ecosystems

This project draws from and interoperates with several public ecosystems and tools. At minimum, public-facing documentation should retain attribution to the following kinds of upstream work when relevant:

- [Tauri](https://tauri.app/)
- [React](https://react.dev/)
- [Vite](https://vite.dev/)
- [hls.js](https://github.com/video-dev/hls.js)
- [dash.js](https://github.com/Dash-Industry-Forum/dash.js)
- [flv.js](https://github.com/bilibili/flv.js)
- [mpegts.js](https://github.com/xqq/mpegts.js)
- [FongMi/TV](https://github.com/FongMi/TV)
- [yoursmile66/TVBox](https://github.com/yoursmile66/TVBox)

These links are listed as upstream references for framework use, compatibility targets, or ecosystem context. They do not imply endorsement.

## Notes For Future Contributions

When adding borrowed code, adapted logic, copied assets, or bundled binaries:

1. Record the original source URL.
2. Record the upstream license.
3. Mark whether the file was copied, modified, or only used as a behavioral reference.
4. Update `docs/OPEN_SOURCE_NOTICE.md`.

That keeps the repository publishable as an open-source project without losing provenance.
