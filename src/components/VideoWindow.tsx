// Renders inside the separate "video" webview window (?video=true).
// Owns its own <video> element; obeys commands from the main window and
// reports playback state back over Tauri events (see lib/videoWindow.ts).
import { useEffect, useRef } from "react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";

interface VideoCmd {
  cmd: "load" | "play" | "pause" | "seek";
  path?: string;
  position?: number;
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

    // Only report genuine media errors — play() can reject (AbortError,
    // autoplay policy) and error events fire (MEDIA_ERR_ABORTED) while the
    // video keeps working fine.
    const reportRealError = () => {
      if (el.src && el.error && el.error.code !== MediaError.MEDIA_ERR_ABORTED) {
        report("error");
      }
    };

    listen<VideoCmd>("amp:video-cmd", (e) => {
      const p = e.payload;
      switch (p.cmd) {
        case "load": {
          // Skip re-setting an identical src — avoids aborting an in-flight load
          const src = p.path ? convertFileSrc(p.path) : "";
          if (src && el.src !== src) el.src = src;
          if (typeof p.position === "number") el.currentTime = p.position;
          if (p.autoplay) el.play().catch(reportRealError);
          break;
        }
        case "play":
          el.play().catch(reportRealError);
          break;
        case "pause":
          el.pause();
          break;
        case "seek":
          if (typeof p.value === "number") el.currentTime = p.value;
          break;
      }
    }).then((f) => {
      unlisten = f;
      // Ready — ask the main window for the current video
      emitTo("main", "amp:video-state", { type: "hello" }).catch(() => {});
    });

    el.addEventListener("timeupdate", () => report("timeupdate"));
    el.addEventListener("ended", () => report("ended"));
    el.addEventListener("error", reportRealError);
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
