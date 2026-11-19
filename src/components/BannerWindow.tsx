// Renders inside the separate "banner" webview window (?banner=true).
// Shows the current banner image with its crop/zoom/filter applied,
// commanded by the main window over Tauri events.
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Banner } from "../types";
import { bannerImgStyle } from "../lib/bannerStyle";

interface BannerCmd {
  cmd: "show" | "blank";
  banner?: Banner;
}

export function BannerWindow() {
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<BannerCmd>("amp:banner-cmd", (e) => {
      const p = e.payload;
      if (p.cmd === "show" && p.banner) setBanner(p.banner);
      else if (p.cmd === "blank") setBanner(null);
    }).then((f) => {
      unlisten = f;
      // Ready — ask the main window for the current banner
      emitTo("main", "amp:banner-state", { type: "hello" }).catch(() => {});
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Double-click toggles true borderless fullscreen (no title/menu bar);
  // Escape exits it.
  useEffect(() => {
    const win = getCurrentWindow();
    const toggle = () => {
      void win
        .isFullscreen()
        .then((fs) => win.setFullscreen(!fs))
        .catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void win.setFullscreen(false).catch(() => {});
    };
    window.addEventListener("dblclick", toggle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("dblclick", toggle);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-black">
      {banner && (
        <img
          src={convertFileSrc(banner.path)}
          alt={banner.name}
          draggable={false}
          style={bannerImgStyle(banner)}
          className="select-none"
        />
      )}
    </div>
  );
}
