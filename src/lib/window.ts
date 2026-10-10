import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const MINI_LABEL = "mini";

export async function openMiniPlayer(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(MINI_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(MINI_LABEL, {
    url: new URL("?mini=true", window.location.href).toString(),
    title: "Animo Mini",
    width: 420,
    height: 120,
    minWidth: 340,
    minHeight: 100,
    decorations: false,
    alwaysOnTop: true,
    resizable: true,
    transparent: false,
  });
  await new Promise<void>((resolve) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", () => resolve());
  });
}
