import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Play, Pause, SkipBack, SkipForward, X, Music } from "lucide-react";
import type { MiniState } from "../lib/bridge";

const EMPTY: MiniState = {
  trackId: null,
  title: "Nothing playing",
  artist: "",
  cover: null,
  isPlaying: false,
  position: 0,
  duration: 0,
};

const cmd = (c: string, value?: number) =>
  emitTo("main", "amp:cmd", { cmd: c, value }).catch(() => {});

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MiniPlayer() {
  const [state, setState] = useState<MiniState>(EMPTY);

  useEffect(() => {
    const un = listen<MiniState>("amp:state", (e) => setState(e.payload));
    // Ask the main window for a fresh snapshot on open
    emitTo("main", "amp:cmd", { cmd: "hello" }).catch(() => {});
    return () => {
      un.then((f) => f());
    };
  }, []);

  const progress = state.duration > 0 ? (state.position / state.duration) * 100 : 0;

  return (
    <div
      data-tauri-drag-region
      className="glass flex h-full items-center gap-3 overflow-hidden px-3"
      role="application"
      aria-label="Animo mini player"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-elevated">
        {state.cover ? (
          <img src={state.cover} alt="Cover" className="h-full w-full object-cover" />
        ) : (
          <Music className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1" data-tauri-drag-region>
        <div className="truncate text-sm font-medium text-foreground">
          {state.title || "Nothing playing"}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {state.artist || "—"}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {formatTime(state.position)}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {formatTime(state.duration)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          aria-label="Previous"
          onClick={() => cmd("prev")}
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <SkipBack className="h-4 w-4 fill-current" />
        </button>
        <button
          aria-label={state.isPlaying ? "Pause" : "Play"}
          onClick={() => cmd("toggle")}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground transition hover:bg-accent-hover"
        >
          {state.isPlaying ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          )}
        </button>
        <button
          aria-label="Next"
          onClick={() => cmd("next")}
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <SkipForward className="h-4 w-4 fill-current" />
        </button>
        <button
          aria-label="Close mini player"
          onClick={() => getCurrentWindow().close()}
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
