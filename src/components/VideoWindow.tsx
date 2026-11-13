// Renders inside the separate "video" webview window (?video=true).
// Owns its own <video> element; obeys commands from the main window and
// reports playback state back over Tauri events (see lib/videoWindow.ts).
import { useEffect, useRef } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { mediaUrl, playViaBlob } from "../lib/player";

interface VideoCmd {
  cmd: "load" | "play" | "pause" | "seek" | "volume" | "fadeout";
  path?: string;
  position?: number;
  volume?: number;
  value?: number;
  autoplay?: boolean;
}

export function VideoWindow() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let unlisten: UnlistenFn | null = null;

    const report = (type: string) =>
      emitTo("main", "amp:video-state", {
        type,
        position: el.currentTime,
      }).catch(() => {});

    let currentPath = "";

    // On failure, retry via the IPC Blob transport — the localhost server
    // may be unreachable (firewall/AV) on some PCs.
    const tryBlobOrReport = () => {
      if (el.error && el.error.code === MediaError.MEDIA_ERR_ABORTED) return;
      if (!currentPath) return;
      void playViaBlob(el, currentPath).then((ok) => {
        if (!ok) report("error");
      });
    };

    listen<VideoCmd>("amp:video-cmd", (e) => {
      const p = e.payload;
      switch (p.cmd) {
        case "load": {
          // Skip re-setting an identical src — avoids aborting an in-flight load
          currentPath = p.path ?? "";
          const src = p.path ? mediaUrl(p.path) : "";
          if (src && el.src !== src) el.src = src;
          if (typeof p.volume === "number") el.volume = p.volume;
          if (typeof p.position === "number") el.currentTime = p.position;
          // Rejected plays route through the blob fallback too — only a
          // failed fallback reports an error (see tryBlobOrReport).
          if (p.autoplay) el.play().catch(tryBlobOrReport);
          break;
        }
        case "play":
          el.play().catch(tryBlobOrReport);
          break;
        case "pause":
          el.pause();
          break;
        case "fadeout": {
          // Smoothly ramp volume down, then pause — used when an audio
          // track takes over while the video was playing.
          const start = el.volume;
          let i = 0;
          const t = setInterval(() => {
            i++;
            el.volume = Math.max(0, start * (1 - i / 20));
            if (i >= 20) {
              clearInterval(t);
              el.pause();
              el.volume = start;
            }
          }, 50);
          break;
        }
        case "seek":
          if (typeof p.value === "number") el.currentTime = p.value;
          break;
        case "volume":
          if (typeof p.value === "number") el.volume = p.value;
          break;
      }
    }).then((f) => {
      unlisten = f;
      // Ready — ask the main window for the current video
      emitTo("main", "amp:video-state", { type: "hello" }).catch(() => {});
    });

    el.addEventListener("timeupdate", () => report("timeupdate"));
    el.addEventListener("ended", () => report("ended"));
    el.addEventListener("error", tryBlobOrReport);
    el.addEventListener("playing", () => report("playing"));
    el.addEventListener("pause", () => report("pause"));

    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-black">
      <video
        ref={ref}
        controls
        playsInline
        className="h-full w-full object-contain"
      />
    </div>
  );
}
