# Animo Media Player

## Commands
- Dev: `npm run tauri dev` (port 1430)
- Frontend typecheck/build: `npx tsc` / `npm run build`
- Rust check: `cd src-tauri && cargo check`
- Release: bump `src-tauri/tauri.conf.json` version + `npm version X --no-git-tag-version`, commit, `git tag vX`, push — GitHub Actions builds Windows/macOS installers and drafts a release.

## Cleanup rule (user preference)
After shipping a release build (or when asked to save space), delete regenerable
artifacts: `src-tauri/target/` (~4.7 GB), `dist/`, and `.DS_Store` files.
Never delete `src-tauri/binaries/` (bundled yt-dlp + ffmpeg — required),
`node_modules/`, `.git/`, or source files.

## Notes
- Windows playback uses IPC Blob fallback (firewalls block the localhost server).
- ALAC m4a files auto-transcode to MP3 via bundled ffmpeg on undecodable error.
- Track numbers come from leading filename digits (`0156_...`) over tag values.
