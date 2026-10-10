// Bridge between the main window (owns the single audio engine) and the
// always-on-top mini player window. Main pushes playback state to "mini";
// mini pushes commands back to "main".
import { emitTo, listen } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import { play, pause, next, prev, seek } from "./player";
import { getCover } from "./cover";
import { restoreMainWindow } from "./window";

export interface MiniState {
  trackId: string | null;
  title: string;
  artist: string;
  cover: string | null;
  isPlaying: boolean;
  position: number;
  duration: number;
}

let lastTrackId: string | null = null;
let lastCover: string | null = null;

function buildState(): MiniState {
  const s = useAppStore.getState();
  const t = s.tracks.find((x) => x.id === s.currentTrackId) ?? null;
  return {
    trackId: t?.id ?? null,
    title: t?.title ?? "",
    artist: t?.artist ?? "",
    cover: lastCover,
    isPlaying: s.isPlaying,
    position: s.position,
    duration: t?.durationSeconds ?? 0,
  };
}

let unsubscribe: (() => void) | null = null;
let unlistenCmds: (() => void) | null = null;

export function startBridge() {
  if (unsubscribe) return;

  unsubscribe = useAppStore.subscribe(async (state) => {
    if (state.currentTrackId !== lastTrackId) {
      lastTrackId = state.currentTrackId;
      const t = state.tracks.find((x) => x.id === state.currentTrackId);
      lastCover = t ? await getCover(t) : null;
    }
    emitTo("mini", "amp:state", buildState()).catch(() => {});
  });

  listen<{ cmd: string; value?: number }>("amp:cmd", (e) => {
    const s = useAppStore.getState();
    switch (e.payload.cmd) {
      case "hello":
        emitTo("mini", "amp:state", buildState()).catch(() => {});
        break;
      case "show-main":
        restoreMainWindow();
        break;
      case "toggle":
        s.isPlaying ? pause() : play();
        break;
      case "next":
        next();
        break;
      case "prev":
        prev();
        break;
      case "seek":
        if (typeof e.payload.value === "number") seek(e.payload.value);
        break;
    }
  }).then((f) => {
    unlistenCmds = f;
  });

  // Tray menu commands come through the same channel
  listen<string>("amp:tray-cmd", (e) => {
    const s = useAppStore.getState();
    switch (e.payload) {
      case "toggle":
        s.isPlaying ? pause() : play();
        break;
      case "next":
        next();
        break;
    }
  });
}

export function stopBridge() {
  unsubscribe?.();
  unsubscribe = null;
  unlistenCmds?.();
  unlistenCmds = null;
}
