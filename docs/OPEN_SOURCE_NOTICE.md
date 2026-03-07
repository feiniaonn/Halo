# Open Source Notice And Provenance

This repository is intended to remain a public open-source project. This file records the current provenance boundary for the Halo workspace and should be updated whenever new third-party code, assets, or bundled binaries are introduced.

## 1. Licensing Boundary

- Unless a file states otherwise, original source code authored for Halo is released under the MIT License in the repository root.
- Third-party dependencies installed through npm, Cargo, Maven-style jars, or other package managers remain under their own upstream licenses.
- Bundled compatibility resources, jars, icons, and other embedded artifacts may have separate redistribution terms and are not implicitly relicensed by the root MIT license.

## 2. Project Positioning

Halo is a desktop application project and compatibility toolkit.

It does **not** claim ownership of:

- Third-party media catalog data
- Streaming endpoints
- User-imported source lists
- Remote site configurations
- Upstream spider/jar ecosystems

Anyone publishing, forking, or redistributing this repository should verify that their use of external resources is lawful and that upstream notices are preserved.

## 3. Referenced Upstream Projects And Ecosystems

The current codebase or documentation references, integrates, or targets behavior from the following public projects/ecosystems:

- Tauri
  - Official site: <https://tauri.app/>
  - Role: desktop runtime and application shell.
- React
  - Official site: <https://react.dev/>
  - Role: front-end UI framework.
- Vite
  - Official site: <https://vite.dev/>
  - Role: front-end build and dev server.
- hls.js
  - Official repository: <https://github.com/video-dev/hls.js>
  - Role: HLS playback support in the web layer.
- dash.js
  - Official repository: <https://github.com/Dash-Industry-Forum/dash.js>
  - Role: DASH playback support.
- flv.js
  - Official repository: <https://github.com/bilibili/flv.js>
  - Role: FLV playback support.
- mpegts.js
  - Official repository: <https://github.com/xqq/mpegts.js>
  - Role: MPEG-TS playback support.
- FongMi/TV
  - Official repository: <https://github.com/FongMi/TV>
  - Role: ecosystem/context reference for TVBox-compatible configuration and behavior.
- yoursmile66/TVBox
  - Official repository: <https://github.com/yoursmile66/TVBox>
  - Role: ecosystem/context reference; the current codebase contains compatibility logic and URL handling around this ecosystem.

These entries document source attribution and interoperability context. They do not imply that Halo is an official derivative, affiliate, or endorsed distribution of any upstream project.

## 4. Bundled Resources Requiring Extra Care

The repository currently contains bundled runtime resources under paths such as:

- `src-tauri/resources/`
- `src-tauri/resources/jar/`
- `src-tauri/resources/local_spiders/`

Before redistributing those files in a public release, verify:

- original source URL
- original license or permission status
- whether modification was performed
- whether redistribution is allowed

If a bundled file originates from a third party, add a per-file or per-directory note describing its origin.

## 5. Documentation And Research Materials

The `docs/` directory contains project notes, source-format research, parsing notes, and interoperability documentation. If any document is copied or adapted from an external author, the copied/adapted document should include:

- original author or project name
- original URL
- adaptation scope
- original license if known

## 6. Contribution Rule For Borrowed Material

When adding borrowed material to this repository, contributors should record at least:

1. Source URL.
2. Upstream project or author.
3. Upstream license.
4. Whether the material was copied, modified, embedded, or only behaviorally referenced.
5. Any redistribution limitation.

This is the minimum bar for keeping the repository openly published with clear provenance.
