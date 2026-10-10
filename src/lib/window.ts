import {
  WebviewWindow,
  getCurrentWebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { useAppStore } from "../store";

const MINI_LABEL = "mini";
const MAIN_LABEL = "main";

/** Bring the main window back (from hidden or minimized) and focus it. */
export async function restoreMainWindow(): Promise<void> {
  const main = await WebviewWindow.getByLabel(MAIN_LABEL);
  if (!main) return;
  await main.show().catch(() => {});
  await main.unminimize().catch(() => {});
  await main.setFocus().catch(() => {});
}

function setMiniFlag(open: boolean) {
  useAppStore.getState().setMiniPlayerOpen(open);
}

/**
 * Open the always-on-top mini player and hide the main window.
 * The main window is restored automatically whenever the mini window is
 * destroyed — regardless of how it was closed — so the user can never be
 * trapped with no visible UI.
 */
export async function openMiniPlayer(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(MINI_LABEL);
  const main = getCurrentWebviewWindow();

  if (existing) {
    await existing.show().catch(() => {});
    await existing.setFocus().catch(() => {});
    await main.hide().catch(() => {});
    return;
  }

  const win = new WebviewWindow(MINI_LABEL, {
    url: new URL("?mini=true", window.location.href).toString(),
    title: "Animo Mini",
    width: 440,
    height: 120,
    minWidth: 340,
    minHeight: 100,
    decorations: false,
    alwaysOnTop: true,
    resizable: true,
  });

  // Hide the main window only once the mini actually exists, so a failed
  // creation never leaves the user with no visible window.
  win.once("tauri://created", () => {
    void main.hide();
    void win.setFocus();
    setMiniFlag(true);
  });
  win.once("tauri://error", (e) => {
    console.error("Failed to create mini player:", e.payload);
  });

  // Restore the main window however the mini gets closed (X button, OS
  // shortcuts, or programmatic close).
  win.once("tauri://destroyed", () => {
    setMiniFlag(false);
    void restoreMainWindow();
  });
}
