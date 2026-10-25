import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import { isVideoPath, type Track } from "../types";

export interface ScannedFile {
  path: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  trackNumber: number | null;
  durationSeconds: number;
  format: string;
  fileSize: number;
  mtimeMs: number;
  readError: string | null;
}

export interface ScanResult {
  files: ScannedFile[];
  errors: string[];
}

const norm = (p: string) => p.toLowerCase();

function toTrack(f: ScannedFile, prev: Track | undefined): Track {
  return {
    id: f.path,
    path: f.path,
    fileName: f.fileName,
    title: f.title || prev?.title || f.fileName,
    artist: f.artist,
    album: f.album,
    trackNumber: f.trackNumber,
    durationSeconds: f.durationSeconds,
    format: f.format,
    fileSize: f.fileSize,
    mtimeMs: f.mtimeMs,
    addedAt: prev?.addedAt ?? Date.now(),
    playCount: prev?.playCount ?? 0,
    lastPlayedAt: prev?.lastPlayedAt ?? null,
    // preserve user-assigned section (including "unsectioned"); new files
    // land in New Songs / Videos
    sectionId: prev ? prev.sectionId : isVideoPath(f.path) ? "videos" : "new-songs",
    missing: false,
  };
}

/** Merge scan output into the library: dedupe by path, preserve user data, mark missing. */
function mergeScan(result: ScanResult, scannedFolders: string[]) {
  const { tracks } = useAppStore.getState();
  const byPath = new Map(tracks.map((t) => [norm(t.id), t]));
  const found = new Set<string>();
  const now = Date.now();

  const merged: Track[] = result.files.map((f) => {
    found.add(norm(f.path));
    return toTrack(f, byPath.get(norm(f.path)));
  });
  void now;

  const roots = scannedFolders.map((f) => norm(f.replace(/[\\/]+$/, "")) + "/");
  const keep = tracks
    .filter((t) => !found.has(norm(t.id)))
    .map((t) => {
      const underScannedFolder = roots.some((r) => norm(t.path).startsWith(r));
      return underScannedFolder ? { ...t, missing: true } : t;
    });

  useAppStore.getState().setTracks([...merged, ...keep]);
  return result;
}

export async function scanLibrary(folders: string[]): Promise<ScanResult> {
  const store = useAppStore.getState();
  if (store.scanning || folders.length === 0) {
    return { files: [], errors: [] };
  }
  store.setScanning(true);
  try {
    const result = await invoke<ScanResult>("scan_folders", { folders });
    return mergeScan(result, folders);
  } finally {
    const s = useAppStore.getState();
    s.setScanning(false);
    s.setScanProgress(null);
  }
}

/** Metadata read for explicitly-chosen files (New Songs workflow).
 *  Reads ONLY the given files — never triggers a library rescan. */
export async function scanFiles(paths: string[]): Promise<ScanResult> {
  return invoke<ScanResult>("scan_files", { paths });
}

/** Recursive scan of specific folders WITHOUT merging into the library —
 *  used for folders dropped onto the app (caller decides the destination). */
export async function scanFoldersRaw(folders: string[]): Promise<ScanResult> {
  return invoke<ScanResult>("scan_folders", { folders });
}

export interface AddResult {
  added: number;
  skipped: number;
}

/** Add scanned files to the library. Files already in the library (by path)
 *  are skipped rather than duplicated. Returns counts for UI feedback. */
export async function addFilesAsTracks(
  files: ScannedFile[],
  sectionId: string,
  overrides?: Map<string, { title?: string; trackNumber?: number | null }>,
): Promise<AddResult> {
  const existing = new Set(
    useAppStore.getState().tracks.map((t) => norm(t.id)),
  );
  const fresh = files.filter((f) => !existing.has(norm(f.path)));
  const tracks = fresh.map((f) => {
    const o = overrides?.get(f.path);
    const t = toTrack(f, undefined);
    return {
      ...t,
      title: o?.title ?? t.title,
      trackNumber: o?.trackNumber !== undefined ? o.trackNumber : t.trackNumber,
      sectionId,
      missing: false,
    };
  });
  if (tracks.length > 0) {
    useAppStore.getState().addTracks(tracks);
  }
  return { added: tracks.length, skipped: files.length - fresh.length };
}
