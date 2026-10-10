import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../types";

const cache = new Map<string, string | null>();

export async function getCover(track: Track): Promise<string | null> {
  if (cache.has(track.id)) return cache.get(track.id) ?? null;
  try {
    const c = await invoke<{ mime: string; base64: string } | null>("read_cover", {
      path: track.path,
    });
    const url = c ? `data:${c.mime};base64,${c.base64}` : null;
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
