// Bridge between the main window and the video pop-up window.
//
// The pop-up hosts its own <video> element (cross-window media elements
// aren't possible), so while it is open it OWNS video playback: the main
// window sends it commands (load/play/pause/seek) and the pop-up reports
// back timeupdate/ended/error/playing/pause over Tauri events — the same
// pattern as the mini player bridge. Closing the pop-up ends video
// playback and returns the main window to its track list.
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useAppStore } from "../store";
import { isVideoPath } from "../types";
import { next, getVideoElement } from "./player";

const LABEL = "video";

export function sendVideoCmd(payload: Record<string, unknown>) {
  sendCmd(payload);
}

function sendCmd(payload: Record<string, unknown>) {
  emitTo(LABEL, "amp:video-cmd", payload).catch(() => {});
}

/** Hand the current video (if any) to the pop-up and pause the local copy. */
function handoffToPopup() {
  const s = useAppStore.getState();
  const t = s.tracks.find((x) => x.id === s.currentTrackId);
  if (!t || !isVideoPath(t.path)) return;
  sendCmd({
    cmd: "load",
    path: t.path,
    position: s.position,
    autoplay: s.isPlaying,
    volume: s.volume,
  });
  getVideoElement()?.pause();
}

/** Pop-up closed/hidden — stop video playback entirely so the main
 *  window goes back to the track list. */
function stopOnPopupClose() {
  const s = useAppStore.getState();
  s.setIsPlaying(false);
  s.setCurrentTrack(null);
  sendCmd({ cmd: "pause" }); // the pop-up's own element keeps its src
  const el = getVideoElement();
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
}

export async function openVideoWindow(): Promise<void> {
  const s = useAppStore.getState();
  const existing = await WebviewWindow.getByLabel(LABEL);
  if (existing) {
    s.setVideoPopupOpen(true);
    // The window may have been hidden or shrunk to 1px by the PiP path —
    // restore a normal visible state before handing it a new video.
    await existing.setIgnoreCursorEvents(false).catch(() => {});
    await existing.setMinSize(new LogicalSize(480, 320)).catch(() => {});
    await existing.setSize(new LogicalSize(960, 600)).catch(() => {});
    await existing.center().catch(() => {});
    await existing.show().catch(() => {});
    await existing.setFocus().catch(() => {});
    handoffToPopup();
    return;
  }

  const win = new WebviewWindow(LABEL, {
    url: new URL("?video=true", window.location.href).toString(),
    title: "Animo Video",
    width: 960,
    height: 600,
    minWidth: 480,
    minHeight: 320,
    center: true,
  });
  win.once("tauri://created", () => {
    useAppStore.getState().setVideoPopupOpen(true);
  });
  // Hide instead of destroying — the webview (and its loaded video) stay
  // alive, so the next video opens instantly instead of waiting for a
  // full window+webview boot each time.
  void win.onCloseRequested((e) => {
    e.preventDefault();
    useAppStore.getState().setVideoPopupOpen(false);
    stopOnPopupClose();
    void win.hide();
  });
  win.once("tauri://destroyed", () => {
    useAppStore.getState().setVideoPopupOpen(false);
    stopOnPopupClose();
  });
  win.once("tauri://error", (e) => {
    console.error("Failed to create video window:", e.payload);
  });
}

export async function closeVideoWindow(): Promise<void> {
  const win = await WebviewWindow.getByLabel(LABEL);
  await win?.close().catch(() => {});
}

interface VideoStatePayload {
  type: "hello" | "timeupdate" | "ended" | "error" | "playing" | "pause";
  position?: number;
}

/** Listen for state reports from the pop-up. Call once from the main window. */
export function startVideoBridge(): void {
  listen<VideoStatePayload>("amp:video-state", (e) => {
    const s = useAppStore.getState();
    const p = e.payload;
    switch (p.type) {
      case "hello":
        s.setVideoPopupOpen(true);
        handoffToPopup();
        break;
      case "timeupdate":
        if (typeof p.position === "number") s.setPosition(p.position);
        break;
      case "playing":
        s.setIsPlaying(true);
        // Self-heal: a video that made it to playback clears any earlier
        // error report / missing flag (e.g. a codec error the blob
        // fallback handled).
        if (s.playbackError) s.setPlaybackError(null);
        {
          const t = s.tracks.find((x) => x.id === s.currentTrackId);
          if (t?.missing) s.updateTrack(t.id, { missing: false });
        }
        break;
      case "pause":
        s.setIsPlaying(false);
        break;
      case "ended":
        if (s.repeat === "one") {
          sendCmd({ cmd: "seek", value: 0 });
          sendCmd({ cmd: "play" });
        } else if (s.autoAdvance) {
          next();
        } else {
          s.setIsPlaying(false);
        }
        break;
      case "error": {
        const t = s.tracks.find((x) => x.id === s.currentTrackId);
        if (t) {
          s.setPlaybackError(
            `Could not play "${t.title}". The file may be missing, moved, or in an unsupported format.`,
          );
          s.updateTrack(t.id, { missing: true });
        }
        s.setIsPlaying(false);
        break;
      }
    }
  }).catch(() => {});
}
