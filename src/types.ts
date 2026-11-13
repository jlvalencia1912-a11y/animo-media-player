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
  /** null = unsectioned: only visible in library-wide views */
  sectionId: string | null;
  missing?: boolean;
}

export interface Section {
  id: string;
  name: string;
  icon: string; // lucide icon key
  parentId: string | null;
  /** When present, the section is an ordered setlist: membership is this
   *  list of track ids (in display order), independent of Track.sectionId.
   *  Dropping tracks here copies them in without unassigning their home. */
  trackIds?: string[];
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
  { id: "recordings", name: "Recordings", icon: "AudioLines", parentId: null },
  { id: "new-songs", name: "New Songs", icon: "Sparkles", parentId: null },
  { id: "appendix", name: "Appendix", icon: "BookOpen", parentId: null },
  { id: "silent-prayer", name: "Silent Prayer", icon: "Moon", parentId: null },
  { id: "sabbath", name: "Sabbath", icon: "Sunrise", parentId: null },
  { id: "sabbath-morning", name: "Morning", icon: "Sunrise", parentId: "sabbath", trackIds: [] },
  { id: "sabbath-afternoon", name: "Afternoon", icon: "Sun", parentId: "sabbath", trackIds: [] },
  { id: "sabbath-evening", name: "Evening", icon: "Sunset", parentId: "sabbath", trackIds: [] },
  { id: "family-event", name: "Family Event", icon: "Users", parentId: null },
  { id: "happy-heart", name: "Happy Heart", icon: "Heart", parentId: null },
  { id: "outloud-prayer", name: "Out-loud Prayer", icon: "Mic", parentId: null },
];

export const AUDIO_EXTENSIONS = ["mp3", "flac", "wav", "aac", "m4a"];
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm"];

const ext = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";
export const isAudioPath = (p: string) => AUDIO_EXTENSIONS.includes(ext(p));
export const isVideoPath = (p: string) => VIDEO_EXTENSIONS.includes(ext(p));
export const isMediaPath = (p: string) => isAudioPath(p) || isVideoPath(p);

/** A track counts as a mic recording when it sits in the Recordings section
 *  OR lives under the recordings export folder (chosen or default). */
export const isRecordingTrack = (
  t: { path: string; sectionId: string | null },
  recordingDir: string,
) => {
  if (t.sectionId === "recordings") return true;
  const p = t.path.replace(/\\/g, "/");
  if (p.includes("/Animo Recordings/")) return true;
  const dir = recordingDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return dir !== "" && p.startsWith(dir + "/");
};

/** Effective track number: leading filename digits ("0156_...") win,
 *  falling back to the tag value. */
export function trackNum(t: { path: string; trackNumber: number | null }) {
  const m = t.path
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.match(/^0*(\d+)[\s_.-]/);
  return m ? parseInt(m[1], 10) : t.trackNumber;
}

/** Time-of-day choices for recordings. */
export const RECORDING_TIMES = [
  "Morning",
  "Afternoon",
  "Evening",
  "Evening (3rd Day)",
];

/** Event labels for filing recordings — selectable in the Recordings view. */
export const RECORDING_EVENTS = [
  "Sabbath",
  "Passover",
  "Unleavened Bread",
  "Resurrection Day",
  "2nd Passover",
  "Ascension Day",
  "Pentecost",
  "Trumpets",
  "Prayer Week",
  "Atonement",
  "Tabernacles",
  "Preaching Week",
  "Last & Greatest Day",
  "Mother's Coming",
  "Father's Coming",
  "Heavenly Parents Day",
];
