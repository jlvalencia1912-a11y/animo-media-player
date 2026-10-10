import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, X, PictureInPicture2 } from "lucide-react";
import { Logo } from "./components/Logo";
import { Sidebar } from "./components/Sidebar";
import { PlayerBar } from "./components/PlayerBar";
import { TrackList } from "./components/TrackList";
import { SettingsPanel } from "./components/SettingsPanel";
import { NewSongsDialog } from "./components/NewSongsDialog";
import { EqualizerPanel } from "./components/EqualizerPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { TagEditorDialog } from "./components/TagEditorDialog";
import { AddFromLinkDialog } from "./components/AddFromLinkDialog";
import { useAppStore } from "./store";
import { play, pause, seek } from "./lib/player";
import { startBridge } from "./lib/bridge";
import { openMiniPlayer } from "./lib/window";

interface ScanProgressPayload {
  scanned: number;
  total: number;
  current: string;
}

export function App() {
  const { scanning, scanProgress, playbackError, setPlaybackError, settings } =
    useAppStore();

  // Main window owns the audio engine; it bridges state/commands to the mini
  // player window and the system tray.
  useEffect(() => {
    startBridge();
  }, []);

  // Keep the native close-to-tray behavior in sync with the setting
  useEffect(() => {
    invoke("set_close_to_tray", { enabled: settings.closeToTray }).catch(() => {});
  }, [settings.closeToTray]);

  // Scan progress events from Rust
  useEffect(() => {
    const un = listen<ScanProgressPayload>("amp:scan-progress", (e) => {
      useAppStore.getState().setScanProgress(e.payload);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
      ) {
        return;
      }
      const s = useAppStore.getState();
      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (s.isPlaying) pause();
          else play();
          break;
        case "ArrowRight":
          seek(s.position + 5);
          break;
        case "ArrowLeft":
          seek(Math.max(0, s.position - 5));
          break;
        case "ArrowUp":
          e.preventDefault();
          s.setVolume(Math.min(1, s.volume + 0.05));
          break;
        case "ArrowDown":
          e.preventDefault();
          s.setVolume(Math.max(0, s.volume - 0.05));
          break;
        case "KeyM":
          s.setMuted(!s.muted);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Title bar area */}
      <header
        data-tauri-drag-region
        className="glass flex h-14 shrink-0 items-center justify-between border-b border-border px-4"
      >
        <Logo />
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {scanning && scanProgress && (
            <span className="tabular-nums" role="status">
              Scanning… {scanProgress.scanned}
              {scanProgress.total > 0 ? ` / ${scanProgress.total}` : ""}
            </span>
          )}
          <button
            onClick={openMiniPlayer}
            aria-label="Open mini player"
            title="Mini player (always on top)"
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <PictureInPicture2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Playback error banner */}
      {playbackError && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-5 py-2 text-sm text-warning"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={playbackError}>
            {playbackError}
          </span>
          <button
            onClick={() => setPlaybackError(null)}
            aria-label="Dismiss error"
            className="rounded p-1 transition hover:bg-warning/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <TrackList />
        </main>
      </div>

      <PlayerBar />

      {/* Dialogs */}
      <SettingsPanel />
      <NewSongsDialog />
      <EqualizerPanel />
      <HistoryPanel />
      <TagEditorDialog />
      <AddFromLinkDialog />
    </div>
  );
}
