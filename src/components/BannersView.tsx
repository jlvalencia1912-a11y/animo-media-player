// The Digital Banners library view — a grid of banner images that can
// be displayed on a second pop-up window, cropped, and color-adjusted.
// Select several banners to apply the same crop edits as a group.
import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ImagePlus,
  MonitorPlay,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useAppStore } from "../store";
import { isImagePath, type Banner } from "../types";
import { bannerImgStyle } from "../lib/bannerStyle";
import { showBanner } from "../lib/bannerWindow";
import { BannerEditor } from "./BannerEditor";

export function BannersView() {
  const {
    banners,
    search,
    setSearch,
    selectedBannerIds,
    toggleBannerSelected,
    setSelectedBannerIds,
    removeBanners,
    currentBannerId,
  } = useAppStore();
  const [editing, setEditing] = useState<Banner | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return banners;
    return banners.filter((b) => b.name.toLowerCase().includes(q));
  }, [banners, search]);

  const addImages = async () => {
    const picked = await open({
      multiple: true,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] },
      ],
    });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    const imgs = paths.filter(isImagePath);
    if (imgs.length) useAppStore.getState().addBanners(imgs);
  };

  const removeSelected = () => {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      setTimeout(() => setConfirmingRemove(false), 3000);
      return;
    }
    setConfirmingRemove(false);
    removeBanners(selectedBannerIds);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <h1 className="font-display text-lg font-semibold text-foreground">
          Digital Banners
        </h1>
        <span className="text-xs text-muted-foreground">
          {visible.length} banner{visible.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {selectedBannerIds.length > 0 && (
            <button
              onClick={removeSelected}
              className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${
                confirmingRemove
                  ? "border-danger bg-danger/15 text-danger"
                  : "border-border bg-surface-elevated text-muted-foreground hover:text-foreground"
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmingRemove
                ? "Confirm remove?"
                : `Remove (${selectedBannerIds.length})`}
            </button>
          )}
          <button
            onClick={() => void addImages()}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-xs font-medium text-accent-foreground transition hover:bg-accent-hover"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            Add images
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search banners…"
              aria-label="Search banners"
              className="h-8 w-48 rounded-lg border border-border bg-surface-elevated pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="amp-noscroll min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-elevated">
              <ImagePlus className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">No banners yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Add images to display on a second window — drag image files
                here, or use the button above.
              </p>
            </div>
            <button
              onClick={() => void addImages()}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover"
            >
              <ImagePlus className="h-4 w-4" /> Add images
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5 p-5">
            {visible.map((b) => {
              const selected = selectedBannerIds.includes(b.id);
              const showing = b.id === currentBannerId;
              return (
                <div
                  key={b.id}
                  onClick={(e) => {
                    if (
                      (e.target as HTMLElement).closest("input, button")
                    )
                      return;
                    if (e.metaKey || e.ctrlKey) toggleBannerSelected(b.id);
                    else setSelectedBannerIds([b.id]);
                  }}
                  onDoubleClick={() => void showBanner(b.id)}
                  aria-selected={showing}
                  className={`group amp-vid-card cursor-default rounded-xl p-1.5 transition ${
                    selected
                      ? "bg-accent/15 ring-1 ring-accent"
                      : showing
                        ? "bg-accent/10"
                        : "hover:bg-surface-hover"
                  }`}
                >
                  <div className="relative aspect-video overflow-hidden rounded-lg border border-border/40 bg-black">
                    <img
                      src={convertFileSrc(b.path)}
                      alt={b.name}
                      draggable={false}
                      style={bannerImgStyle(b)}
                    />
                    {/* Hover actions */}
                    <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => void showBanner(b.id)}
                        title="Show on banner window"
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-white/90 px-2.5 text-xs font-medium text-black shadow transition hover:bg-white"
                      >
                        <MonitorPlay className="h-3.5 w-3.5" />
                        Show
                      </button>
                      <button
                        onClick={() => setEditing(b)}
                        title="Edit crop / brightness / contrast"
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-white/20 px-2.5 text-xs font-medium text-white backdrop-blur transition hover:bg-white/30"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    </div>
                    <input
                      type="checkbox"
                      aria-label={`Select ${b.name}`}
                      checked={selected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleBannerSelected(b.id)}
                      className={`absolute left-2 top-2 h-4 w-4 accent-accent transition ${
                        selected
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                    />
                    {showing && (
                      <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">
                        On air
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-2 truncate px-0.5 text-sm font-medium text-foreground"
                    title={b.name}
                  >
                    {b.name}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <BannerEditor
          banner={editing}
          applyToSelected={selectedBannerIds.length > 1}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
