# Animo Media Player

A modern, dark, keyboard-friendly music player for Windows, built with Tauri 2 + React.

![icon](src-tauri/icons/128x128.png)

## Features

- **Library** — monitor any folders on your PC (e.g. `C:\Users\<you>\Music`). Scanning runs in Rust and reports live progress; files are deduplicated by path and user data (section, play counts) survives rescans. Removed folders prune their tracks.
- **Sections** — New Songs, Appendix, Silent Prayer, Sabbath (Morning / Afternoon / Evening), Family Event, Happy Heart, Out-loud Prayer.
- **New Songs workflow** — pick audio files manually, edit track number and title per file, then add them to a section.
- **Playback** — MP3, FLAC, WAV, AAC, M4A via the WebView2 engine. Play / pause / prev / next / seek / volume / repeat (off-all-one) / shuffle.
- **Global media keys** — Windows SMTC integration via the Media Session API (play/pause/next/prev while minimized).
- **10-band equalizer** — presets, ±12 dB bands and preamp, clipping warning, one-click reset. Implemented with Web Audio BiquadFilters.
- **Cover art** — extracted by Rust (`lofty`) and shown in the player bar, mini player and system media overlay.
- **Play history** — timestamped, capped at 500 entries, clearable.
- **Playlists** — create, delete, add selected tracks.
- **Bulk tag editor** — write title/artist/album/track-number/genre into the files, preserving all other tags and cover art. Per-file success/failure results, requires explicit confirmation.
- **System tray** — Show / Play-Pause / Next / Quit menu. "Close to tray" is configurable in Settings.
- **Mini player** — frameless always-on-top remote window (single audio engine stays in the main window; the mini player is a remote view).
- **Device selection** — output via `AudioContext.setSinkId` and microphone **monitoring** via `getUserMedia` (monitoring only, no recording).
- **Keyboard** — Space play/pause, ←/→ seek ±5 s, ↑/↓ volume, M mute, Escape closes dialogs.

## Requirements

| | |
|---|---|
| Target OS | Windows 10 (1803+) / Windows 11, x64 or ARM64 |
| Runtime | Microsoft Edge WebView2 Runtime (preinstalled on Windows 11 and most Windows 10 installs) |
| Dev build | Node.js 20+, Rust (stable), `npm i -D @tauri-apps/cli` |

No internet connection is required for playback or library browsing.

## Development

```bash
npm install        # frontend deps
npm run tauri dev  # starts Vite + the desktop app
```

## Production build

```bash
npm run tauri build
```

Installers land in `src-tauri/target/release/bundle/` (`.msi` and `.exe` on Windows).

## Architecture

```
src/                  React + TypeScript UI (Tailwind v4, Zustand)
  lib/player.ts       HTMLAudioElement -> Web Audio graph (preamp -> 10x BiquadFilter -> master gain)
  lib/library.ts      scan merge/dedupe, New Songs helpers
  lib/bridge.ts       main <-> mini window + tray event bridge (single audio engine in main)
  lib/cover.ts        cover-art cache
src-tauri/src/lib.rs  Rust commands: folder scan (walkdir), metadata + tag write (lofty),
                      cover extraction, tray icon, close-to-tray
```

Persistence (library, sections, playlists, history, settings) is a small JSON store in the webview's `localStorage`, keyed `animo-media-player`. A `TrackSource` abstraction point exists conceptually in `Track.path`/`TrackSource`-style fields should an authorized external source ever be evaluated — **YouTube audio download/extraction is deliberately not implemented**; any future implementation must use an authorized source and comply with applicable terms.

## Known limitations

- **WASAPI exclusive / ASIO** are *not* available. The WebView2 audio engine always outputs through Windows shared mode. An exclusive path would require a native audio backend (e.g. `cpal`/WASAPI) and is noted in Settings. No bit-perfect output is claimed.
- **Output device selection** depends on `AudioContext.setSinkId`, which WebView2 supports on Windows. If it fails, playback falls back to the system default and the app says so.
- **Media Session (global media keys)** covers play/pause/next/prev/seek on Windows; the "stop" hardware key is not handled.
- **Microphone** is monitoring-only (routed to output at 0.9 gain to reduce feedback); there is no recording.
- `window`-level notifications and file-association ("Open with") are not implemented in this release.

## Project status

Fully implemented: library scanning, sections, New Songs workflow, all transport controls, EQ, history, playlists, tag write-back, tray, mini player, media keys, missing-file handling, device selection/monitoring.

Limited by engine/OS: exclusive audio output modes (see above), hardware "stop" key.
