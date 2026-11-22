// Bridge between the main window and the banner display pop-up — same
// pattern as the video pop-up: the window is created once and then
// hidden/reused so showing a banner is instant.
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { useAppStore } from "../store";

const LABEL = "banner";

export function sendBannerCmd(payload: Record<string, unknown>) {
  emitTo(LABEL, "amp:banner-cmd", payload).catch(() => {});
}

/** Re-send the current banner — after edits or when a reused window
 *  reports hello. */
export function resendCurrentBanner() {
  const s = useAppStore.getState();
  const b = s.banners.find((x) => x.id === s.currentBannerId);
  if (b) sendBannerCmd({ cmd: "show", banner: b });
}

export async function showBanner(id: string): Promise<void> {
  const s = useAppStore.getState();
  s.setCurrentBanner(id);
  await openBannerWindow();
  resendCurrentBanner();
}

export async function openBannerWindow(): Promise<void> {
  const s = useAppStore.getState();
  const existing = await WebviewWindow.getByLabel(LABEL);
  if (existing) {
    s.setBannerPopupOpen(true);
    // Resizing a fullscreen window drops it out of fullscreen — only
    // re-fit when it isn't fullscreen.
    const fs = await existing.isFullscreen().catch(() => false);
    if (!fs) {
      await existing.setSize(new LogicalSize(1200, 750)).catch(() => {});
      await existing.center().catch(() => {});
    }
    await existing.show().catch(() => {});
    await existing.setFocus().catch(() => {});
    return;
  }
  const win = new WebviewWindow(LABEL, {
    url: new URL("?banner=true", window.location.href).toString(),
    title: "Animo Banner",
    width: 1200,
    height: 750,
    minWidth: 640,
    minHeight: 400,
    center: true,
  });
  win.once("tauri://created", () => {
    useAppStore.getState().setBannerPopupOpen(true);
  });
  // Hide instead of destroying — reopening a banner is instant.
  void win.onCloseRequested((e) => {
    e.preventDefault();
    useAppStore.getState().setBannerPopupOpen(false);
    sendBannerCmd({ cmd: "blank" });
    void win.hide();
  });
  win.once("tauri://destroyed", () => {
    useAppStore.getState().setBannerPopupOpen(false);
  });
  win.once("tauri://error", (e) => {
    console.error("Failed to create banner window:", e.payload);
  });
}

export async function closeBannerWindow(): Promise<void> {
  const win = await WebviewWindow.getByLabel(LABEL);
  await win?.close().catch(() => {});
}

/** Listen for the pop-up's hello so we can resend the image. Call once
 *  from the main window. */
export function startBannerBridge(): void {
  listen<{ type: string }>("amp:banner-state", (e) => {
    if (e.payload.type === "hello") {
      useAppStore.getState().setBannerPopupOpen(true);
      resendCurrentBanner();
    }
  }).catch(() => {});
}
