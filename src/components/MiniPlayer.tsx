import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Music,
  Maximize2,
} from "lucide-react";
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

// Close the mini player; the main window registers a tauri://destroyed
// listener and restores itself, and we also nudge it here for immediacy.
const closeMini = async () => {
  await cmd("show-main");
  await getCurrentWindow().close().catch(() => {});
};

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

  const progress =
    state.duration > 0 ? (state.position / state.duration) * 100 : 0;

  // Frameless-window drag: grab any non-interactive part of the window.
  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, input, a, select, [data-no-drag]")) return;
    void getCurrentWindow().startDragging();
  };

  return (
    <div
      onMouseDown={startDrag}
      className="glass flex h-full cursor-grab items-center gap-3 overflow-hidden px-3 active:cursor-grabbing"
      role="application"
      aria-label="Animo mini player"
    >
      <div
        data-no-drag
        className="flex h-14 w-14 shrink-0 cursor-default items-center justify-center overflow-hidden rounded-lg bg-surface-elevated"
      >
        {state.cover ? (
          <img
            src={state.cover}
            alt="Cover"
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <Music className="h-5 w-5 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1 select-none">
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

      <div
        data-no-drag
        className="flex shrink-0 cursor-default items-center gap-1.5"
      >
        <button
          aria-label="Previous track"
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
          aria-label="Next track"
          onClick={() => cmd("next")}
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <SkipForward className="h-4 w-4 fill-current" />
        </button>
        <button
          aria-label="Open main window"
          title="Open main window"
          onClick={closeMini}
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label="Close mini player"
          title="Close mini player"
          onClick={closeMini}
          className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
