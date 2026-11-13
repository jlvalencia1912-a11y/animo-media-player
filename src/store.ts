import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Track,
  Playlist,
  HistoryEntry,
  MonitoredFolder,
  Section,
} from "./types";
import { DEFAULT_SECTIONS, isVideoPath } from "./types";

export type RepeatMode = "off" | "all" | "one";
export type ViewMode =
  | { kind: "section"; id: string }
  | { kind: "playlist"; id: string }
  | { kind: "recent-added" }
  | { kind: "videos" }
  | { kind: "all" };

/** Where a drag is hovering. "view" resolves to whatever the track list shows;
 *  "reorder" is a row in an ordered section (insert before `beforeId`,
 *  null = append at end). */
export type DropTarget =
  | { kind: "section"; id: string }
  | { kind: "playlist"; id: string }
  | { kind: "reorder"; beforeId: string | null }
  | { kind: "view" };

interface AppState {
  // Library
  tracks: Track[];
  sections: Section[];
  playlists: Playlist[];
  /** Manual order for the All Videos view (video track ids). Videos not in
   *  the list render after it, title-sorted. */
  videoOrder: string[];
  monitoredFolders: MonitoredFolder[];
  history: HistoryEntry[];
  scanning: boolean;
  scanProgress: { scanned: number; total: number; current: string } | null;

  // Playback
  currentTrackId: string | null;
  isPlaying: boolean;
  position: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  queue: string[];
  /** false = don't auto-advance when a track ends (ordered setlists —
   *  Morning/Afternoon/Evening — wait for a manual play). */
  autoAdvance: boolean;

  // Playback health / selection
  playbackError: string | null;
  selectedTrackIds: string[];

  // Drag & drop (transient — which drop zone is hovered, and what's dragged)
  dropTarget: DropTarget | null;
  trackDrag: { ids: string[]; x: number; y: number } | null;

  // Video pop-up window owns playback when open (transient)
  videoPopupOpen: boolean;

  // Mic recording in progress (transient)
  recording: { startedAt: number; mime: string } | null;

  // UI
  view: ViewMode;
  search: string;
  sortBy: "title" | "artist" | "album" | "addedAt" | "trackNumber";
  sortDir: "asc" | "desc";
  showSettings: boolean;
  showTagEditor: boolean;
  showNewSongs: boolean;
  showHistory: boolean;
  showEqualizer: boolean;
  showLinkDialog: boolean;
  miniPlayerOpen: boolean;

  // Settings
  settings: {
    closeToTray: boolean;
    volume: number;
    eqEnabled: boolean;
    eqPreamp: number;
    eqBands: number[];
    outputDeviceId: string;
    micMonitoring: boolean;
    micDeviceId: string;
    showCovers: boolean;
    theme: "dark" | "light";
    recordingEvent: string;
    recordingTime: string;
    /** Export folder for mic recordings; empty = ~/Desktop/Animo Recordings */
    recordingDir: string;
  };

  // Actions
  setTracks: (t: Track[]) => void;
  addTracks: (t: Track[]) => void;
  updateTrack: (id: string, updates: Partial<Track>) => void;
  removeTracksUnder: (folderPath: string) => void;
  setPlaybackError: (e: string | null) => void;
  setSelectedTrackIds: (ids: string[]) => void;
  toggleTrackSelected: (id: string) => void;
  setScanning: (s: boolean) => void;
  setScanProgress: (p: AppState["scanProgress"]) => void;
  setView: (v: ViewMode) => void;
  setSearch: (s: string) => void;
  setSortBy: (s: AppState["sortBy"]) => void;
  setSortDir: (d: AppState["sortDir"]) => void;
  setCurrentTrack: (id: string | null) => void;
  setIsPlaying: (p: boolean) => void;
  setPosition: (p: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  setRepeat: (r: RepeatMode) => void;
  setShuffle: (s: boolean) => void;
  setQueue: (q: string[], autoAdvance?: boolean) => void;
  updateSettings: (s: Partial<AppState["settings"]>) => void;
  setMonitoredFolders: (f: MonitoredFolder[]) => void;
  setPlaylists: (p: Playlist[]) => void;
  createPlaylist: (name: string) => void;
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) => void;
  deletePlaylist: (playlistId: string) => void;
  moveTracksToSection: (trackIds: string[], sectionId: string) => void;
  reorderSectionTracks: (
    sectionId: string,
    dragIds: string[],
    beforeId: string | null,
  ) => void;
  reorderVideoTracks: (dragIds: string[], beforeId: string | null) => void;
  removeTracksFromOrderedSection: (
    sectionId: string,
    trackIds: string[],
  ) => void;
  unassignTracksFromSection: (trackIds: string[]) => void;
  removeTracksFromPlaylist: (playlistId: string, trackIds: string[]) => void;
  removeTracks: (trackIds: string[]) => void;
  setDropTarget: (t: DropTarget | null) => void;
  setTrackDrag: (d: AppState["trackDrag"]) => void;
  setVideoPopupOpen: (b: boolean) => void;
  setRecording: (r: AppState["recording"]) => void;
  setHistory: (h: HistoryEntry[]) => void;
  addHistoryEntry: (e: HistoryEntry) => void;
  setSections: (s: Section[]) => void;
  setShowSettings: (b: boolean) => void;
  setShowTagEditor: (b: boolean) => void;
  setShowNewSongs: (b: boolean) => void;
  setShowHistory: (b: boolean) => void;
  setShowEqualizer: (b: boolean) => void;
  setShowLinkDialog: (b: boolean) => void;
  setMiniPlayerOpen: (b: boolean) => void;
  incrementPlayCount: (trackId: string) => void;
  markTracksMissing: (paths: string[]) => void;
}

// Persisted state is written at most once per second and flushed on unload.
// Without this, every set() (position ticks during playback, scan progress
// events) synchronously serialized the whole track library to localStorage,
// which made the UI stutter badly on large libraries.
function debouncedStorage(name: string, delayMs = 1000) {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (pending !== null) {
      try {
        localStorage.setItem(name, pending);
      } catch {
        // storage full / unavailable — non-fatal
      }
      pending = null;
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", flush);
  }
  return {
    getItem: () => localStorage.getItem(name),
    setItem: (_n: string, value: string) => {
      pending = value;
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    removeItem: () => {
      pending = null;
      localStorage.removeItem(name);
    },
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      tracks: [],
      sections: DEFAULT_SECTIONS,
      playlists: [],
      videoOrder: [],
      monitoredFolders: [],
      history: [],
      scanning: false,
      scanProgress: null,

      currentTrackId: null,
      isPlaying: false,
      position: 0,
      volume: 0.8,
      muted: false,
      repeat: "off",
      shuffle: false,
      queue: [],
      autoAdvance: true,

      playbackError: null,
      selectedTrackIds: [],
      dropTarget: null,
      trackDrag: null,
      videoPopupOpen: false,
      recording: null,

      view: { kind: "all" },
      search: "",
      sortBy: "title",
      sortDir: "asc",
      showSettings: false,
      showTagEditor: false,
      showNewSongs: false,
      showHistory: false,
      showEqualizer: false,
      showLinkDialog: false,
      miniPlayerOpen: false,

      settings: {
        closeToTray: true,
        volume: 0.8,
        eqEnabled: true,
        eqPreamp: 0,
        eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        outputDeviceId: "default",
        micMonitoring: false,
        micDeviceId: "default",
        showCovers: true,
        theme: "dark",
        recordingEvent: "",
        recordingTime: "",
        recordingDir: "",
      },

      setTracks: (tracks) => set({ tracks }),
      addTracks: (incoming) => {
        const existing = new Set(get().tracks.map((t) => t.id.toLowerCase()));
        set({
          tracks: [
            ...get().tracks,
            ...incoming.filter((t) => !existing.has(t.id.toLowerCase())),
          ],
        });
      },
      updateTrack: (id, updates) =>
        set({
          tracks: get().tracks.map((t) =>
            t.id === id ? { ...t, ...updates } : t,
          ),
        }),
      removeTracksUnder: (folderPath) =>
        set({
          tracks: get().tracks.filter(
            (t) =>
              !t.path
                .toLowerCase()
                .startsWith(folderPath.toLowerCase().replace(/[\\/]+$/, "") + "/"),
          ),
        }),
      setPlaybackError: (playbackError) => set({ playbackError }),
      setSelectedTrackIds: (selectedTrackIds) => set({ selectedTrackIds }),
      toggleTrackSelected: (id) =>
        set({
          selectedTrackIds: get().selectedTrackIds.includes(id)
            ? get().selectedTrackIds.filter((x) => x !== id)
            : [...get().selectedTrackIds, id],
        }),
      setScanning: (scanning) => set({ scanning }),
      setScanProgress: (scanProgress) => set({ scanProgress }),
      setView: (view) => set({ view }),
      setSearch: (search) => set({ search }),
      setSortBy: (sortBy) => set({ sortBy }),
      setSortDir: (sortDir) => set({ sortDir }),
      setCurrentTrack: (currentTrackId) => set({ currentTrackId }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setPosition: (position) => set({ position }),
      setVolume: (volume) => set({ volume }),
      setMuted: (muted) => set({ muted }),
      setRepeat: (repeat) => set({ repeat }),
      setShuffle: (shuffle) => set({ shuffle }),
      setQueue: (queue, autoAdvance = true) => set({ queue, autoAdvance }),
      updateSettings: (s) => set({ settings: { ...get().settings, ...s } }),
      setMonitoredFolders: (monitoredFolders) => set({ monitoredFolders }),
      setPlaylists: (playlists) => set({ playlists }),
      createPlaylist: (name) =>
        set({
          playlists: [
            ...get().playlists,
            {
              id: crypto.randomUUID(),
              name: name.trim() || "Untitled playlist",
              trackIds: [],
              createdAt: Date.now(),
            },
          ],
        }),
      addTracksToPlaylist: (playlistId, trackIds) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === playlistId
              ? { ...p, trackIds: [...new Set([...p.trackIds, ...trackIds])] }
              : p,
          ),
        }),
      deletePlaylist: (playlistId) => {
        const v = get().view;
        set({
          playlists: get().playlists.filter((p) => p.id !== playlistId),
          view:
            v.kind === "playlist" && v.id === playlistId
              ? { kind: "all" }
              : v,
        });
      },
      moveTracksToSection: (trackIds, sectionId) => {
        const sec = get().sections.find((s) => s.id === sectionId);
        if (sec?.trackIds) {
          // Ordered sections are setlists — dropping copies the tracks in
          // (appended in order) without touching their home section.
          set({
            sections: get().sections.map((s) =>
              s.id === sectionId
                ? {
                    ...s,
                    trackIds: [
                      ...(s.trackIds ?? []),
                      ...trackIds.filter(
                        (id) => !(s.trackIds ?? []).includes(id),
                      ),
                    ],
                  }
                : s,
            ),
          });
          return;
        }
        set({
          tracks: get().tracks.map((t) =>
            trackIds.includes(t.id) ? { ...t, sectionId } : t,
          ),
        });
      },
      reorderSectionTracks: (sectionId, dragIds, beforeId) => {
        // Dropping onto a dragged row changes nothing.
        if (beforeId && dragIds.includes(beforeId)) return;
        set({
          sections: get().sections.map((s) => {
            if (s.id !== sectionId || !s.trackIds) return s;
            const moved = s.trackIds.filter((id) => dragIds.includes(id));
            // Stragglers (membership via sectionId, not yet in the list)
            // join the dragged block in drag order.
            for (const id of dragIds) {
              if (!moved.includes(id) && !s.trackIds.includes(id)) {
                moved.push(id);
              }
            }
            const rest = s.trackIds.filter((id) => !dragIds.includes(id));
            const at = beforeId ? rest.indexOf(beforeId) : -1;
            const idx = at === -1 ? rest.length : at;
            return {
              ...s,
              trackIds: [
                ...rest.slice(0, idx),
                ...moved,
                ...rest.slice(idx),
              ],
            };
          }),
        });
      },
      reorderVideoTracks: (dragIds, beforeId) => {
        // Dropping onto a dragged row changes nothing.
        if (beforeId && dragIds.includes(beforeId)) return;
        const s = get();
        const videos = s.tracks.filter((t) => isVideoPath(t.path));
        // Merge the saved order with videos not in it yet (title-sorted).
        const known = s.videoOrder.filter((id) =>
          videos.some((v) => v.id === id),
        );
        const fresh = videos
          .filter((v) => !known.includes(v.id))
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((v) => v.id);
        const list = [...known, ...fresh];
        const moved = list.filter((id) => dragIds.includes(id));
        for (const id of dragIds) {
          if (!moved.includes(id) && !list.includes(id)) moved.push(id);
        }
        const rest = list.filter((id) => !dragIds.includes(id));
        const at = beforeId ? rest.indexOf(beforeId) : -1;
        const idx = at === -1 ? rest.length : at;
        set({
          videoOrder: [
            ...rest.slice(0, idx),
            ...moved,
            ...rest.slice(idx),
          ],
        });
      },
      removeTracksFromOrderedSection: (sectionId, trackIds) =>
        set({
          sections: get().sections.map((s) =>
            s.id === sectionId && s.trackIds
              ? {
                  ...s,
                  trackIds: s.trackIds.filter(
                    (id) => !trackIds.includes(id),
                  ),
                }
              : s,
          ),
          selectedTrackIds: [],
        }),
      // Remove tracks from their section but keep them in the library.
      unassignTracksFromSection: (trackIds) =>
        set({
          tracks: get().tracks.map((t) =>
            trackIds.includes(t.id) ? { ...t, sectionId: null } : t,
          ),
          selectedTrackIds: [],
        }),
      removeTracksFromPlaylist: (playlistId, trackIds) =>
        set({
          playlists: get().playlists.map((p) =>
            p.id === playlistId
              ? {
                  ...p,
                  trackIds: p.trackIds.filter((id) => !trackIds.includes(id)),
                }
              : p,
          ),
        }),
      // Removes tracks from the library only — files on disk are untouched.
      removeTracks: (trackIds) => {
        const s = get();
        const removedCurrent =
          s.currentTrackId !== null && trackIds.includes(s.currentTrackId);
        set({
          tracks: s.tracks.filter((t) => !trackIds.includes(t.id)),
          playlists: s.playlists.map((p) => ({
            ...p,
            trackIds: p.trackIds.filter((id) => !trackIds.includes(id)),
          })),
          sections: s.sections.map((sec) =>
            sec.trackIds
              ? {
                  ...sec,
                  trackIds: sec.trackIds.filter(
                    (id) => !trackIds.includes(id),
                  ),
                }
              : sec,
          ),
          queue: s.queue.filter((id) => !trackIds.includes(id)),
          videoOrder: s.videoOrder.filter((id) => !trackIds.includes(id)),
          selectedTrackIds: [],
          ...(removedCurrent
            ? { currentTrackId: null, position: 0, isPlaying: false }
            : {}),
        });
      },
      setDropTarget: (dropTarget) => set({ dropTarget }),
      setTrackDrag: (trackDrag) => set({ trackDrag }),
      setVideoPopupOpen: (videoPopupOpen) => set({ videoPopupOpen }),
      setRecording: (recording) => set({ recording }),
      setHistory: (history) => set({ history }),
      addHistoryEntry: (e) => set({ history: [e, ...get().history].slice(0, 500) }),
      setSections: (sections) => set({ sections }),
      setShowSettings: (showSettings) => set({ showSettings }),
      setShowTagEditor: (showTagEditor) => set({ showTagEditor }),
      setShowNewSongs: (showNewSongs) => set({ showNewSongs }),
      setShowHistory: (showHistory) => set({ showHistory }),
      setShowEqualizer: (showEqualizer) => set({ showEqualizer }),
      setShowLinkDialog: (showLinkDialog) => set({ showLinkDialog }),
      setMiniPlayerOpen: (miniPlayerOpen) => set({ miniPlayerOpen }),
      incrementPlayCount: (trackId) =>
        set({
          tracks: get().tracks.map((t) =>
            t.id === trackId
              ? { ...t, playCount: t.playCount + 1, lastPlayedAt: Date.now() }
              : t,
          ),
        }),
      markTracksMissing: (paths) =>
        set({
          tracks: get().tracks.map((t) =>
            paths.includes(t.path) ? { ...t, missing: true } : t,
          ),
        }),
    }),
    {
      name: "animo-media-player",
      storage: createJSONStorage(() => debouncedStorage("animo-media-player")),
      partialize: (s) => ({
        sections: s.sections,
        playlists: s.playlists,
        videoOrder: s.videoOrder,
        monitoredFolders: s.monitoredFolders,
        history: s.history,
        tracks: s.tracks,
        settings: s.settings,
        volume: s.volume,
        repeat: s.repeat,
        shuffle: s.shuffle,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        // Built-in sections that existed in saved state but were removed
        // from DEFAULT_SECTIONS (videos live in the All Videos view now).
        const REMOVED_SECTIONS = new Set(["videos"]);
        // Union persisted sections with defaults so newly-added built-in
        // sections appear for existing users; spread defaults first so keys
        // added since (e.g. trackIds on ordered sections) get filled in.
        const sections = (p.sections ?? current.sections)
          .filter((s) => !REMOVED_SECTIONS.has(s.id))
          .map((s) => {
            const d = DEFAULT_SECTIONS.find((x) => x.id === s.id);
            return d ? { ...d, ...s } : s;
          });
        for (const d of DEFAULT_SECTIONS) {
          if (!sections.some((s) => s.id === d.id)) sections.push({ ...d });
        }
        // Built-in sections display in DEFAULT_SECTIONS order (e.g.
        // Recordings above New Songs); custom sections keep their order
        // after them.
        const defOrder = new Map(
          DEFAULT_SECTIONS.map((d, i) => [d.id, i] as const),
        );
        sections.sort(
          (a, b) =>
            (defOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (defOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        );
        // Migrate tracks: ordered sections own membership via trackIds, so
        // stale sectionIds pointing at them fold into the list; ids of
        // removed sections (e.g. "videos") become unsectioned.
        const validIds = new Set(sections.map((s) => s.id));
        const orderedById = new Map(
          sections.filter((s) => s.trackIds).map((s) => [s.id, s]),
        );
        const tracks = (p.tracks ?? current.tracks).map((t) => {
          const sec = t.sectionId ? orderedById.get(t.sectionId) : undefined;
          if (sec) {
            if (!sec.trackIds!.includes(t.id)) {
              sec.trackIds = [...sec.trackIds!, t.id];
            }
            return { ...t, sectionId: null };
          }
          if (t.sectionId !== null && !validIds.has(t.sectionId)) {
            return { ...t, sectionId: null };
          }
          return t;
        });
        return {
          ...current,
          ...p,
          sections,
          tracks,
          // Fill new settings keys with defaults for existing saved settings
          settings: { ...current.settings, ...p.settings },
        };
      },
    },
  ),
);
