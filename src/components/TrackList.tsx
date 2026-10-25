import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ArrowUpDown, Music2, Music, FolderPlus, Sparkles, Tags, Youtube, GripVertical, Trash2, Video, Eye, EyeOff } from "lucide-react";
import { useAppStore } from "../store";
import { playTrack, pause } from "../lib/player";
import { startTrackDrag } from "../lib/dnd";
import { getCover, peekCover } from "../lib/cover";
import { isRecordingTrack, isVideoPath, type Track } from "../types";

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SORT_LABELS: Record<string, string> = {
  title: "Title",
  artist: "Artist",
  album: "Album",
  addedAt: "Date added",
  trackNumber: "Track #",
};

function CoverThumb({ track }: { track: Track }) {
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
    return (
      <img
        src={url}
        alt=""
        className="h-6 w-6 shrink-0 rounded object-cover"
      />
    );
  }
  const Icon = isVideoPath(track.path) ? Video : Music;
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-elevated">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
    </span>
  );
}

export function TrackList() {
  const {
    tracks,
    sections,
    playlists,
    view,
    search,
    setSearch,
    sortBy,
    setSortBy,
    sortDir,
    setSortDir,
    currentTrackId,
    setQueue,
    setShowSettings,
    selectedTrackIds,
    toggleTrackSelected,
    setSelectedTrackIds,
    setShowTagEditor,
    addTracksToPlaylist,
    setShowLinkDialog,
    dropTarget,
    removeTracks,
    removeTracksFromPlaylist,
    unassignTracksFromSection,
    setView,
    settings,
    updateSettings,
  } = useAppStore();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  // Anchor row index for Shift-click range selection
  const lastIndexRef = useRef(0);

  const sectionName = useMemo(() => {
    if (view.kind === "section") {
      return sections.find((s) => s.id === view.id)?.name ?? "Section";
    }
    if (view.kind === "playlist") {
      return playlists.find((p) => p.id === view.id)?.name ?? "Playlist";
    }
    if (view.kind === "recent-added") return "Recently Added";
    if (view.kind === "recent-played") return "Recently Played";
    if (view.kind === "videos") return "Videos";
    return "All Songs";
  }, [view, sections, playlists]);

  const visible = useMemo(() => {
    let list = tracks;
    if (view.kind === "section") {
      const childIds = sections
        .filter((s) => s.parentId === view.id)
        .map((s) => s.id);
      const ids = new Set([view.id, ...childIds]);
      // The Recordings section also catches files under the recordings
      // folder even if their sectionId got out of sync.
      list =
        view.id === "recordings"
          ? list.filter(
              (t) =>
                (t.sectionId !== null && ids.has(t.sectionId)) ||
                isRecordingTrack(t, settings.recordingDir),
            )
          : list.filter(
              (t) => t.sectionId !== null && ids.has(t.sectionId),
            );
    } else if (view.kind === "all") {
      // Library tabs keep audio and video separated; recordings live only
      // in the Recordings section
      list = list.filter(
        (t) => !isVideoPath(t.path) && !isRecordingTrack(t, settings.recordingDir),
      );
    } else if (view.kind === "videos") {
      list = list.filter((t) => isVideoPath(t.path));
    } else if (view.kind === "playlist") {
      const pl = playlists.find((p) => p.id === view.id);
      const order = new Map((pl?.trackIds ?? []).map((id, i) => [id, i]));
      list = list.filter((t) => order.has(t.id));
    } else if (view.kind === "recent-added") {
      list = [...list].sort((a, b) => b.addedAt - a.addedAt).slice(0, 100);
    } else if (view.kind === "recent-played") {
      list = list
        .filter((t) => t.lastPlayedAt)
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
        .slice(0, 100);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q),
      );
    }
    if (view.kind !== "recent-added" && view.kind !== "recent-played") {
      const dir = sortDir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const av = a[sortBy] ?? "";
        const bv = b[sortBy] ?? "";
        return (
          dir *
          (typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv)))
        );
      });
    }
    return list;
  }, [tracks, view, search, sortBy, sortDir, sections, playlists]);

  const startPlayback = (track: Track) => {
    setQueue(visible.map((t) => t.id));
    playTrack(track);
  };

  const removeSelected = () => {
    if (view.kind === "playlist") {
      removeTracksFromPlaylist(view.id, selectedTrackIds);
      setSelectedTrackIds([]);
      return;
    }
    if (view.kind === "section" && view.id !== "recordings") {
      // Keep the tracks in the library — just unassign this section.
      unassignTracksFromSection(selectedTrackIds);
      return;
    }
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      setTimeout(() => setConfirmingRemove(false), 3000);
      return;
    }
    setConfirmingRemove(false);
    pause();
    removeTracks(selectedTrackIds);
  };

  // ⌘/Ctrl-click toggles a row; Shift-click selects the range from the
  // last-clicked row. Dragging a selected row moves the whole selection.
  const onRowClick = (e: React.MouseEvent, t: Track, i: number) => {
    if (e.shiftKey) {
      e.preventDefault();
      const [a, b] = [lastIndexRef.current, i].sort((x, y) => x - y);
      setSelectedTrackIds(visible.slice(a, b + 1).map((x) => x.id));
    } else if (e.metaKey || e.ctrlKey) {
      toggleTrackSelected(t.id);
    }
    lastIndexRef.current = i;
  };

  const beginDrag = (e: React.PointerEvent, t: Track) => {
    if (e.button !== 0) return;
    // Let clicks on interactive elements (checkbox etc.) through untouched
    if ((e.target as HTMLElement).closest("input, button, select, a")) return;
    // Prevent WebKit's native drag-select — it highlights text/rows while dragging
    e.preventDefault();
    const ids = selectedTrackIds.includes(t.id) ? selectedTrackIds : [t.id];
    startTrackDrag(ids, e.clientX, e.clientY);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <h1 className="font-display text-lg font-semibold text-foreground">
          {sectionName}
        </h1>
        {(view.kind === "all" || view.kind === "videos") && (
          <div
            role="tablist"
            aria-label="Library media type"
            className="flex rounded-lg border border-border bg-surface-elevated p-0.5 text-xs"
          >
            {(
              [
                { kind: "all" as const, label: "Music" },
                { kind: "videos" as const, label: "Videos" },
              ]
            ).map((tab) => (
              <button
                key={tab.kind}
                role="tab"
                aria-selected={view.kind === tab.kind}
                onClick={() => setView({ kind: tab.kind })}
                className={`rounded-md px-3 py-1 transition ${
                  view.kind === tab.kind
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {visible.length} track{visible.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {selectedTrackIds.length > 0 && (
            <>
              <button
                onClick={() => setShowTagEditor(true)}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-xs font-medium text-accent-foreground transition hover:bg-accent-hover"
              >
                <Tags className="h-3.5 w-3.5" />
                Edit tags ({selectedTrackIds.length})
              </button>
              <button
                onClick={removeSelected}
                className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${
                  confirmingRemove
                    ? "border-danger bg-danger/15 text-danger"
                    : "border-border bg-surface-elevated text-muted-foreground hover:text-foreground"
                }`}
                title={
                  view.kind === "playlist"
                    ? "Remove selected tracks from this playlist"
                    : view.kind === "section" && view.id !== "recordings"
                      ? "Remove from this section — stays in your library"
                      : "Remove selected tracks from the library (files stay on disk)"
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
                {view.kind === "playlist"
                  ? "Remove from playlist"
                  : view.kind === "section" && view.id !== "recordings"
                    ? "Remove from section"
                    : confirmingRemove
                      ? "Confirm remove?"
                      : "Remove"}
              </button>
              {playlists.length > 0 && (
                <select
                  defaultValue=""
                  aria-label="Add selected to playlist"
                  onChange={(e) => {
                    if (e.target.value) {
                      addTracksToPlaylist(e.target.value, selectedTrackIds);
                      setSelectedTrackIds([]);
                    }
                    e.target.value = "";
                  }}
                  className="h-8 rounded-lg border border-border bg-surface-elevated px-2 text-xs text-muted-foreground focus:border-accent focus:outline-none"
                >
                  <option value="" disabled>
                    Add to playlist…
                  </option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id} className="bg-surface-elevated">
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <button
            onClick={() => setShowLinkDialog(true)}
            aria-label="Add from a link"
            title="Add from a link"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <Youtube className="h-3.5 w-3.5" />
            Link
          </button>
          <button
            onClick={() => updateSettings({ showCovers: !settings.showCovers })}
            aria-label={settings.showCovers ? "Hide album artwork" : "Show album artwork"}
            title={settings.showCovers ? "Hide album artwork" : "Show album artwork"}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-elevated text-muted-foreground transition hover:text-foreground"
          >
            {settings.showCovers ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, artist, album…"
              aria-label="Search library"
              className="h-8 w-56 rounded-lg border border-border bg-surface-elevated pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none"
            />
          </div>
          <button
            onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            aria-label={`Sort direction: ${sortDir}`}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              onClick={(e) => e.stopPropagation()}
              aria-label="Sort by"
              className="cursor-pointer bg-transparent text-xs focus:outline-none"
            >
              {Object.entries(SORT_LABELS).map(([k, v]) => (
                <option key={k} value={k} className="bg-surface-elevated">
                  {v}
                </option>
              ))}
            </select>
          </button>
        </div>
      </div>

      {/* List — also a drop zone for OS files (target = current view) */}
      <div
        className={`min-h-0 flex-1 overflow-y-auto transition ${
          dropTarget?.kind === "view" ? "ring-2 ring-inset ring-accent" : ""
        }`}
      >
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-elevated">
              <Music2 className="h-7 w-7 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">No music here yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {tracks.length === 0
                  ? "Add a folder in Settings to scan your media collection, use New Songs to add tracks manually, or drag audio/video files here."
                  : "No tracks match this view or search."}
              </p>
            </div>
            {tracks.length === 0 && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover"
                >
                  <FolderPlus className="h-4 w-4" /> Add folder
                </button>
                <button
                  onClick={() => useAppStore.getState().setShowNewSongs(true)}
                  className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-foreground transition hover:bg-surface-hover"
                >
                  <Sparkles className="h-4 w-4" /> New Songs
                </button>
                <button
                  onClick={() => setShowLinkDialog(true)}
                  className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-foreground transition hover:bg-surface-hover"
                >
                  <Youtube className="h-4 w-4" /> Add from link
                </button>
              </div>
            )}
          </div>
        ) : (
          <table className="w-full border-collapse text-sm" role="grid" aria-label="Tracks">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="w-6 px-1 py-2" aria-label="Drag handle column" />
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all tracks"
                    checked={visible.length > 0 && selectedTrackIds.length === visible.length}
                    onChange={(e) =>
                      setSelectedTrackIds(e.target.checked ? visible.map((t) => t.id) : [])
                    }
                    className="h-3.5 w-3.5 accent-accent"
                  />
                </th>
                <th className="w-10 px-3 py-2 text-right font-medium">#</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="w-52 px-3 py-2 font-medium">Artist</th>
                <th className="w-52 px-3 py-2 font-medium">Album</th>
                <th className="w-16 px-5 py-2 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t, i) => (
                <tr
                  key={t.id}
                  onDoubleClick={() => startPlayback(t)}
                  onClick={(e) => onRowClick(e, t, i)}
                  onPointerDown={(e) => beginDrag(e, t)}
                  aria-selected={t.id === currentTrackId}
                  className={`group cursor-default border-b border-border/40 transition ${
                    selectedTrackIds.includes(t.id)
                      ? "bg-accent/15 text-foreground"
                      : t.id === currentTrackId
                        ? "bg-accent/10 text-foreground"
                        : "text-foreground/90 hover:bg-surface-hover"
                  }`}
                >
                  <td className="px-1 py-2.5">
                    <span
                      aria-label={`Drag ${t.title}`}
                      title="Drag to a section or playlist — ⌘/⇧-click rows to select several"
                      className="flex cursor-grab touch-none items-center justify-center text-muted-foreground/40 transition group-hover:text-muted-foreground active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${t.title}`}
                      checked={selectedTrackIds.includes(t.id)}
                      onChange={() => toggleTrackSelected(t.id)}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                    {t.trackNumber ?? i + 1}
                  </td>
                  <td
                    className="max-w-0 truncate px-3 py-2.5 font-medium"
                    title="Drag to a section or playlist"
                  >
                    <span className="inline-flex max-w-full cursor-grab touch-none items-center gap-2 active:cursor-grabbing">
                      {settings.showCovers ? (
                        <CoverThumb track={t} />
                      ) : (
                        isVideoPath(t.path) && (
                          <Video className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )
                      )}
                      {t.missing ? (
                        <span className="truncate text-warning" title="File not found">
                          {t.title} ⚠
                        </span>
                      ) : (
                        <span className="truncate">{t.title}</span>
                      )}
                    </span>
                  </td>
                  <td className="max-w-0 truncate px-3 py-2.5 text-muted-foreground">
                    {t.artist || "Unknown artist"}
                  </td>
                  <td className="max-w-0 truncate px-3 py-2.5 text-muted-foreground">
                    {t.album || "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                    {formatTime(t.durationSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
