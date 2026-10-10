import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Track,
  Playlist,
  HistoryEntry,
  MonitoredFolder,
  Section,
} from "./types";
import { DEFAULT_SECTIONS } from "./types";

export type RepeatMode = "off" | "all" | "one";
export type ViewMode =
  | { kind: "section"; id: string }
  | { kind: "playlist"; id: string }
  | { kind: "recent-added" }
  | { kind: "recent-played" }
  | { kind: "all" };

interface AppState {
  // Library
  tracks: Track[];
  sections: Section[];
  playlists: Playlist[];
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

  // Playback health / selection
  playbackError: string | null;
  selectedTrackIds: string[];

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
  setQueue: (q: string[]) => void;
  updateSettings: (s: Partial<AppState["settings"]>) => void;
  setMonitoredFolders: (f: MonitoredFolder[]) => void;
  setPlaylists: (p: Playlist[]) => void;
  createPlaylist: (name: string) => void;
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) => void;
  deletePlaylist: (playlistId: string) => void;
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

      playbackError: null,
      selectedTrackIds: [],

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
      setQueue: (queue) => set({ queue }),
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
        monitoredFolders: s.monitoredFolders,
        history: s.history,
        tracks: s.tracks,
        settings: s.settings,
        volume: s.volume,
        repeat: s.repeat,
        shuffle: s.shuffle,
      }),
    },
  ),
);
