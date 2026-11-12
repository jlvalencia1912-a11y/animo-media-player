import { invoke } from "@tauri-apps/api/core";
import { isVideoPath, type Track } from "../types";

const cache = new Map<string, string | null>();

interface Cover {
  mime: string;
  base64: string;
}

// ffmpeg spawns are expensive — cap concurrent thumbnail grabs so a long
// list of videos doesn't launch dozens of processes at once.
let inflight = 0;
const waiters: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  while (inflight >= 3) {
    await new Promise<void>((r) => waiters.push(r));
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    waiters.shift()?.();
  }
}

export async function getCover(track: Track): Promise<string | null> {
  if (cache.has(track.id)) return cache.get(track.id) ?? null;
  try {
    const c = await invoke<Cover | null>("read_cover", { path: track.path });
    const found = c ?? (isVideoPath(track.path) ? await limited(() =>
      invoke<Cover | null>("video_thumbnail", { path: track.path }),
    ) : null);
    const url = found ? `data:${found.mime};base64,${found.base64}` : null;
    cache.set(track.id, url);
    return url;
  } catch {
    cache.set(track.id, null);
    return null;
  }
}

export function peekCover(trackId: string): string | null | undefined {
  return cache.get(trackId);
}
