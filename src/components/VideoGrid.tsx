// Grid view for the All Videos library — thumbnail cards like a video
// site: big preview, duration badge, title underneath, and a play
// button that pops out on hover. Cards stay drag-reorderable, can be
// renamed inline, and carry a 1–3 heart rating.
import { useEffect, useRef, useState } from "react";
import { Heart, Pause, Pencil, Play, Video } from "lucide-react";
import { getCover, peekCover } from "../lib/cover";
import { useAppStore } from "../store";
import type { Track } from "../types";

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Thumb({ track }: { track: Track }) {
  const [url, setUrl] = useState<string | null | undefined>(() =>
    peekCover(track.id),
  );
  useEffect(() => {
    let cancelled = false;
    getCover(track).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [track.id]);
  if (url) {
    return <img src={url} alt="" className="h-full w-full object-cover" />;
  }
  return (
    <span className="flex h-full w-full items-center justify-center">
      <Video className="h-10 w-10 text-muted-foreground/40" />
    </span>
  );
}

/** Three clickable hearts — click N to set that rating, click the
 *  current level again to clear. */
function Hearts({
  hearts,
  onRate,
  className = "",
}: {
  hearts: number;
  onRate: (n: number) => void;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-0.5 ${className}`}>
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          onClick={(e) => {
            e.stopPropagation();
            onRate(hearts === n ? 0 : n);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Rate ${n} heart${n === 1 ? "" : "s"}`}
          title={`${n} heart${n === 1 ? "" : "s"}`}
          className="p-0.5"
        >
          <Heart
            className={`h-3.5 w-3.5 transition ${
              n <= hearts
                ? "fill-red-500 text-red-500"
                : "fill-black/40 text-white/70 hover:text-white"
            }`}
          />
        </button>
      ))}
    </span>
  );
}

interface Props {
  tracks: Track[];
  currentTrackId: string | null;
  isPlaying: boolean;
  selectedIds: string[];
  onPlay: (t: Track) => void;
  onCardClick: (e: React.MouseEvent, t: Track, i: number) => void;
  onToggleSelect: (id: string) => void;
  beginDrag: (e: React.PointerEvent, t: Track) => void;
}

export function VideoGrid({
  tracks,
  currentTrackId,
  isPlaying,
  selectedIds,
  onPlay,
  onCardClick,
  onToggleSelect,
  beginDrag,
}: Props) {
  const updateTrack = useAppStore((s) => s.updateTrack);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commitRename = (t: Track) => {
    const name = draft.trim();
    if (name && name !== t.title) {
      updateTrack(t.id, { title: name, customTitle: true });
    }
    setRenaming(null);
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-5 p-5">
      {tracks.map((t, i) => {
        const active = t.id === currentTrackId;
        const selected = selectedIds.includes(t.id);
        const hearts = t.hearts ?? 0;
        return (
          <div
            key={t.id}
            data-reorder-before={t.id}
            onClick={(e) => onCardClick(e, t, i)}
            onDoubleClick={() => onPlay(t)}
            onPointerDown={(e) => beginDrag(e, t)}
            aria-selected={active}
            className={`group amp-vid-card cursor-default rounded-xl p-1.5 transition ${
              selected
                ? "bg-accent/15 ring-1 ring-accent"
                : active
                  ? "bg-accent/10"
                  : "hover:bg-surface-hover"
            }`}
          >
            <div className="relative aspect-video overflow-hidden rounded-lg border border-border/40 bg-surface-elevated">
              <Thumb track={t} />
              {/* Hover play button — springs out from below */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(t);
                }}
                aria-label={
                  active && isPlaying ? `Pause ${t.title}` : `Play ${t.title}`
                }
                className="amp-play-pop absolute inset-0 flex items-center justify-center bg-black/35"
              >
                <span
                  className={`flex h-14 w-14 items-center justify-center rounded-full shadow-xl backdrop-blur-sm transition ${
                    active
                      ? "bg-accent text-accent-foreground"
                      : "bg-white/90 text-black"
                  }`}
                >
                  {active && isPlaying ? (
                    <Pause className="h-6 w-6 fill-current" />
                  ) : (
                    <Play className="ml-1 h-6 w-6 fill-current" />
                  )}
                </span>
              </button>
              {/* Duration badge */}
              {t.durationSeconds > 0 && (
                <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
                  {formatTime(t.durationSeconds)}
                </span>
              )}
              {/* Hearts — bottom-left on hover (always visible when rated) */}
              <span
                className={`absolute bottom-1 left-1 rounded-md bg-black/60 px-1 py-0.5 backdrop-blur-sm transition ${
                  hearts > 0
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <Hearts
                  hearts={hearts}
                  onRate={(n) => updateTrack(t.id, { hearts: n })}
                />
              </span>
              {/* Rename */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDraft(t.title);
                  setRenaming(t.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Rename ${t.title}`}
                title="Rename"
                className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1.5 text-white/80 opacity-0 backdrop-blur-sm transition hover:text-white group-hover:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {/* Selection checkbox */}
              <input
                type="checkbox"
                aria-label={`Select ${t.title}`}
                checked={selected}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggleSelect(t.id)}
                onPointerDown={(e) => e.stopPropagation()}
                className={`absolute left-2 top-2 h-4 w-4 accent-accent transition ${
                  selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              />
            </div>
            <div className="mt-2 flex items-center gap-1.5 px-0.5">
              {renaming === t.id ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitRename(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(t);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="New title"
                  className="h-6 min-w-0 flex-1 rounded border border-accent bg-surface-elevated px-1.5 text-sm text-foreground focus:outline-none"
                />
              ) : (
                <>
                  <p
                    className={`min-w-0 flex-1 truncate text-sm font-medium ${
                      t.missing ? "text-warning" : "text-foreground"
                    }`}
                    title={t.title}
                  >
                    {t.title}
                    {t.missing ? " ⚠" : ""}
                  </p>
                  {hearts > 0 && (
                    <span className="flex shrink-0 items-center gap-px">
                      {Array.from({ length: hearts }).map((_, n) => (
                        <Heart
                          key={n}
                          className="h-3 w-3 fill-red-500 text-red-500"
                        />
                      ))}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
