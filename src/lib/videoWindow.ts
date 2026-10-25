// Bridge between the main window and the video pop-up window.
//
// The pop-up hosts its own <video> element (cross-window media elements
// aren't possible), so while it is open it OWNS video playback: the main
// window sends it commands (load/play/pause/seek) and the pop-up reports
// back timeupdate/ended/error/playing/pause over Tauri events — the same
// pattern as the mini player bridge. When the pop-up closes, playback
// hands back to the in-window overlay at the last known position.
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAppStore } from "../store";
import { isVideoPath } from "../types";
import { next, getVideoElement } from "./player";

const LABEL = "video";

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
  });
  getVideoElement()?.pause();
}

/** Pop-up closed — resume the video in the in-window overlay. */
function resumeInOverlay() {
  const s = useAppStore.getState();
  const t = s.tracks.find((x) => x.id === s.currentTrackId);
  const el = getVideoElement();
  if (!t || !el || !isVideoPath(t.path)) return;
  el.currentTime = s.position;
  if (s.isPlaying) el.play().catch(() => {});
}

export async function openVideoWindow(): Promise<void> {
  const s = useAppStore.getState();
  const existing = await WebviewWindow.getByLabel(LABEL);
  if (existing) {
    s.setVideoPopupOpen(true);
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
  win.once("tauri://destroyed", () => {
    useAppStore.getState().setVideoPopupOpen(false);
    resumeInOverlay();
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
        break;
      case "pause":
        s.setIsPlaying(false);
        break;
      case "ended":
        if (s.repeat === "one") {
          sendCmd({ cmd: "seek", value: 0 });
          sendCmd({ cmd: "play" });
        } else {
          next();
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
