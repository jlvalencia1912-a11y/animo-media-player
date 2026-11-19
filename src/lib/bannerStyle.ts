// Shared display math for digital banners — the same crop/zoom/filter
// style is used in the library grid, the editor preview, and the banner
// pop-up window so edits are WYSIWYG everywhere.
import type { CSSProperties } from "react";
import type { BannerEdits } from "../types";

export function bannerImgStyle(e: BannerEdits): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: `${e.cropX * 100}% ${e.cropY * 100}%`,
    transform: `scale(${e.zoom})`,
    filter: `brightness(${e.brightness}) contrast(${e.contrast})`,
  };
}
