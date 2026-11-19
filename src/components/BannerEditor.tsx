// Editor for a digital banner: drag the preview to choose the visible
// region (crop), and adjust zoom / brightness / contrast. Can apply the
// same edits to every selected banner — the "group edits" workflow.
import { useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import type { Banner, BannerEdits } from "../types";
import { bannerImgStyle } from "../lib/bannerStyle";
import { resendCurrentBanner } from "../lib/bannerWindow";
import { useAppStore } from "../store";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-10 text-right tabular-nums">{value.toFixed(2)}</span>
    </label>
  );
}

export function BannerEditor({
  banner,
  applyToSelected,
  onClose,
}: {
  banner: Banner;
  applyToSelected: boolean;
  onClose: () => void;
}) {
  const updateBanner = useAppStore((s) => s.updateBanner);
  const applyBannerEdits = useAppStore((s) => s.applyBannerEdits);
  const selectedBannerIds = useAppStore((s) => s.selectedBannerIds);
  const bannerPopupOpen = useAppStore((s) => s.bannerPopupOpen);
  const currentBannerId = useAppStore((s) => s.currentBannerId);
  const [edits, setEdits] = useState<BannerEdits>({
    cropX: banner.cropX,
    cropY: banner.cropY,
    zoom: banner.zoom,
    brightness: banner.brightness,
    contrast: banner.contrast,
  });
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Dragging pans the visible region: object-position fraction moves
  // opposite the pointer, scaled by zoom.
  const pan = (clientX: number, clientY: number) => {
    const el = frameRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fx = clamp01((clientX - r.left) / r.width);
    const fy = clamp01((clientY - r.top) / r.height);
    setEdits((e) => ({ ...e, cropX: fx, cropY: fy }));
  };

  const save = (ids: string[]) => {
    if (ids.length === 1 && ids[0] === banner.id) {
      updateBanner(banner.id, edits);
    } else {
      applyBannerEdits(ids, edits);
    }
    // Live-update the banner window if it's showing this banner.
    if (bannerPopupOpen && currentBannerId && ids.includes(currentBannerId)) {
      resendCurrentBanner();
    }
    onClose();
  };

  const targetIds = [banner.id];

  return (
    <div
      role="dialog"
      aria-label={`Edit ${banner.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(720px,92vw)] rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="truncate font-display text-base font-semibold text-foreground">
            {banner.name}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close editor"
            className="rounded p-1 text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Crop frame — click/drag to move the visible region */}
        <div
          ref={frameRef}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            pan(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (dragging.current) pan(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          title="Drag to choose the visible region"
          className="relative aspect-video w-full cursor-move overflow-hidden rounded-lg border border-border bg-black"
        >
          <img
            src={convertFileSrc(banner.path)}
            alt={banner.name}
            draggable={false}
            style={bannerImgStyle(edits)}
            className="pointer-events-none select-none"
          />
          {/* Center reticle — shows where the focal point is */}
          <span
            className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80 shadow"
            style={{
              left: `${edits.cropX * 100}%`,
              top: `${edits.cropY * 100}%`,
            }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Drag the image to crop; use the sliders to zoom and adjust.
        </p>

        <div className="mt-4 flex flex-col gap-2.5">
          <Slider
            label="Zoom"
            value={edits.zoom}
            min={1}
            max={4}
            step={0.05}
            onChange={(v) => setEdits((e) => ({ ...e, zoom: v }))}
          />
          <Slider
            label="Brightness"
            value={edits.brightness}
            min={0.2}
            max={2}
            step={0.05}
            onChange={(v) => setEdits((e) => ({ ...e, brightness: v }))}
          />
          <Slider
            label="Contrast"
            value={edits.contrast}
            min={0.2}
            max={2}
            step={0.05}
            onChange={(v) => setEdits((e) => ({ ...e, contrast: v }))}
          />
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={() =>
              setEdits({
                cropX: 0.5,
                cropY: 0.5,
                zoom: 1,
                brightness: 1,
                contrast: 1,
              })
            }
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            Reset
          </button>
          {applyToSelected && selectedBannerIds.length > 1 && (
            <button
              onClick={() => save(selectedBannerIds)}
              className="rounded-lg border border-accent/60 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/10"
            >
              Apply to {selectedBannerIds.length} selected
            </button>
          )}
          <button
            onClick={() => save(targetIds)}
            className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-accent-foreground transition hover:bg-accent-hover"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
