// Renders inside the separate "video" webview window (?video=true).
// Owns its own <video> element; obeys commands from the main window and
// reports playback state back over Tauri events (see lib/videoWindow.ts).
import { useEffect, useRef } from "react";
import { PictureInPicture2 } from "lucide-react";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
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
  const pipEnterRef = useRef<(() => void) | null>(null);

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
    // may be unreachable (firewall/AV) on some PCs. Transient startup
    // errors often self-recover, so only report if it stays broken; the
    // attempt cap stops a blob<->server retry loop on truly bad files.
    let errTimer = 0;
    let attempts = 0;
    const scheduleReport = () => {
      window.clearTimeout(errTimer);
      errTimer = window.setTimeout(() => {
        if (el.error || el.readyState === 0) report("error");
      }, 800);
    };
    const tryBlobOrReport = () => {
      // Bare play() rejections (AbortError, autoplay) have no el.error —
      // only a real media error justifies a full-file IPC read.
      if (!el.error || el.error.code === MediaError.MEDIA_ERR_ABORTED) return;
      if (!currentPath) return;
      attempts++;
      if (attempts <= 2 && !el.src.startsWith("blob:")) {
        void playViaBlob(el, currentPath).then((ok) => {
          if (ok === true) return;
          // Blob transport failed too — give the server URL one more try.
          el.src = mediaUrl(currentPath);
          el.load();
          el.play().catch(scheduleReport);
        });
        return;
      }
      scheduleReport();
    };

    listen<VideoCmd>("amp:video-cmd", (e) => {
      const p = e.payload;
      switch (p.cmd) {
        case "load": {
          // Skip re-setting an identical src — avoids aborting an in-flight load
          currentPath = p.path ?? "";
          attempts = 0;
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
    el.addEventListener("playing", () => {
      window.clearTimeout(errTimer);
      report("playing");
    });
    el.addEventListener("pause", () => report("pause"));

    // Picture-in-Picture: while the OS PiP owns the video this window is
    // just a black screen — get it off screen, and bring it back when PiP
    // exits. macOS refuses to hide() or miniaturize a window that owns a
    // live PiP session, so instead we shrink it to a single point: still
    // a legal restore target for the PiP "return" button, but invisible
    // and click-through. Restore size + focus when PiP exits.
    const appWin = getCurrentWebviewWindow();
    const wkEl = el as HTMLVideoElement & {
      webkitPresentationMode?: string;
      webkitDisplayingFullscreen?: boolean;
    };
    let inPip = false;
    let wasPlayingBeforePip = false;
    let prevSize: PhysicalSize | null = null;
    let prevPos: PhysicalPosition | null = null;
    const dbg = (m: string) =>
      void invoke("dbg_log", { msg: `[video] ${m}` }).catch(() => {});
    const enterPip = () => {
      if (inPip) return;
      inPip = true;
      dbg("enterPip");
      wasPlayingBeforePip = !el.paused;
      void (async () => {
        prevSize = await appWin.innerSize().catch(() => null);
        prevPos = await appWin.outerPosition().catch(() => null);
        // hide()/minimize() are refused while a window owns PiP — a 1px
        // window parked offscreen is invisible but stays a valid
        // restore target for the PiP "return" button.
        await appWin.setMinSize(undefined).catch(() => {});
        await appWin.setSize(new PhysicalSize(1, 1)).catch((e) => dbg(`setSize err ${e}`));
        await appWin
          .setPosition(new PhysicalPosition(-4000, -4000))
          .catch(() => {});
        await appWin.setIgnoreCursorEvents(true).catch(() => {});
      })();
    };
    const exitPip = () => {
      if (!inPip) return;
      inPip = false;
      dbg("exitPip");
      void (async () => {
        await appWin.setIgnoreCursorEvents(false).catch(() => {});
        await appWin.setMinSize(new LogicalSize(480, 320)).catch(() => {});
        await appWin
          .setSize(prevSize ?? new LogicalSize(960, 600))
          .catch(() => {});
        if (prevPos) await appWin.setPosition(prevPos).catch(() => {});
        await appWin.show().catch(() => {});
        await appWin.setFocus().catch(() => {});
      })();
      // Exiting PiP pauses the element on some webviews — resume if it
      // was playing when PiP took over.
      if (wasPlayingBeforePip) void el.play().catch(() => {});
    };
    pipEnterRef.current = enterPip;
    // WKWebView fires these events but does NOT reliably populate
    // pictureInPictureElement/webkitPresentationMode for the native
    // AVKit path — handle the events directly rather than re-deriving
    // state from the properties.
    el.addEventListener("enterpictureinpicture", () => {
      dbg("EVENT enterpictureinpicture");
      enterPip();
    });
    el.addEventListener("leavepictureinpicture", () => {
      dbg("EVENT leavepictureinpicture");
      exitPip();
    });
    const wkModeChanged = () => {
      const m = wkEl.webkitPresentationMode;
      dbg(`EVENT webkitpresentationmodechanged mode=${m}`);
      if (m === "picture-in-picture") enterPip();
      else if (m === "inline") exitPip();
    };
    el.addEventListener("webkitpresentationmodechanged", wkModeChanged);
    document.addEventListener("webkitpresentationmodechanged", wkModeChanged);
    // Native AVKit PiP fires nothing in JS — the Rust watcher spots the
    // OS-level PiP panel instead and relays it here.
    listen<boolean>("amp:pip-native", (e) => {
      if (e.payload) enterPip();
      else exitPip();
    }).then((f) => {
      const prev = unlisten;
      unlisten = () => {
        prev?.();
        f();
      };
    });

    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div className="relative flex h-screen w-screen items-center justify-center bg-black">
      <video
        ref={ref}
        controls
        playsInline
        className="h-full w-full object-contain"
      />
      {/* Custom PiP trigger — tries every JS path (all unsupported in
          WKWebView, where only the native controls button works); kept
          for the day a webview honours one of them. */}
      <button
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          const wk = el as HTMLVideoElement & {
            webkitPresentationMode?: string;
            webkitSetPresentationMode?: (m: string) => void;
          };
          const inPip =
            document.pictureInPictureElement === el ||
            wk.webkitPresentationMode === "picture-in-picture";
          if (inPip) {
            if (document.pictureInPictureElement === el) {
              void document.exitPictureInPicture().catch(() => {});
            } else {
              wk.webkitSetPresentationMode?.("inline");
            }
          } else if (el.requestPictureInPicture) {
            void el
              .requestPictureInPicture()
              .then(() => pipEnterRef.current?.())
              .catch((e) =>
                invoke("dbg_log", { msg: `[video] reqPip rejected: ${e}` }),
              );
          } else if (wk.webkitSetPresentationMode) {
            wk.webkitSetPresentationMode("picture-in-picture");
          }
        }}
        aria-label="Picture in Picture"
        title="Picture in Picture"
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2.5 text-white backdrop-blur transition hover:bg-white/25"
      >
        <PictureInPicture2 className="h-5 w-5" />
      </button>
    </div>
  );
}
