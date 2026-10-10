export interface Track {
  /** Stable id = normalized absolute path */
  id: string;
  path: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  trackNumber: number | null;
  durationSeconds: number;
  format: string;
  fileSize: number;
  mtimeMs: number;
  addedAt: number;
  playCount: number;
  lastPlayedAt: number | null;
  sectionId: string;
  missing?: boolean;
}

export interface Section {
  id: string;
  name: string;
  icon: string; // lucide icon key
  parentId: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export interface HistoryEntry {
  trackId: string;
  title: string;
  artist: string;
  playedAt: number;
}

export interface MonitoredFolder {
  path: string;
  addedAt: number;
}

export const DEFAULT_SECTIONS: Section[] = [
  { id: "new-songs", name: "New Songs", icon: "Sparkles", parentId: null },
  { id: "appendix", name: "Appendix", icon: "BookOpen", parentId: null },
  { id: "silent-prayer", name: "Silent Prayer", icon: "Moon", parentId: null },
  { id: "sabbath", name: "Sabbath", icon: "Sunrise", parentId: null },
  { id: "sabbath-morning", name: "Morning", icon: "Sunrise", parentId: "sabbath" },
  { id: "sabbath-afternoon", name: "Afternoon", icon: "Sun", parentId: "sabbath" },
  { id: "sabbath-evening", name: "Evening", icon: "Sunset", parentId: "sabbath" },
  { id: "family-event", name: "Family Event", icon: "Users", parentId: null },
  { id: "happy-heart", name: "Happy Heart", icon: "Heart", parentId: null },
  { id: "outloud-prayer", name: "Out-loud Prayer", icon: "Mic", parentId: null },
];

export const AUDIO_EXTENSIONS = ["mp3", "flac", "wav", "aac", "m4a"];
