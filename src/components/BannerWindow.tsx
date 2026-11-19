// Renders inside the separate "banner" webview window (?banner=true).
// Shows the current banner image with its crop/zoom/filter applied,
// commanded by the main window over Tauri events.
import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
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
