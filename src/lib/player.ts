import { invoke } from "@tauri-apps/api/core";

/** Stream media via the app's embedded HTTP server — works on local,
 *  mapped-drive, and UNC network paths on every platform. */
let mediaPort = 48760;
export async function initMediaPort() {
  try {
    const p = await invoke<number>("media_port");
    if (p) mediaPort = p;
  } catch {}
}
export const mediaUrl = (p: string) =>
  `http://127.0.0.1:${mediaPort}/${encodeURIComponent(p)}`;
import { emitTo } from "@tauri-apps/api/event";
import { useAppStore } from "../store";
import { isVideoPath, type Track } from "../types";

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let preamp: GainNode | null = null;
let masterGain: GainNode | null = null;
let filters: BiquadFilterNode[] = [];
let micSource: MediaStreamAudioSourceNode | null = null;
let micGain: GainNode | null = null;
let micStream: MediaStream | null = null;
let listenersBound = false;
let videoEl: HTMLVideoElement | null = null;
let videoListenersBound = false;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
  }
  if (!ctx) {
    ctx = new AudioContext();
    const src = ctx.createMediaElementSource(audio);
    preamp = ctx.createGain();
    masterGain = ctx.createGain();
    // chain: source -> preamp -> filters -> master -> destination
    src.connect(preamp);
    let node: AudioNode = preamp;
    filters = EQ_FREQUENCIES.map((f, i) => {
      const bq = ctx!.createBiquadFilter();
      bq.type = i === 0 ? "lowshelf" : i === EQ_FREQUENCIES.length - 1 ? "highshelf" : "peaking";
      bq.frequency.value = f;
      bq.Q.value = 1.0;
      bq.gain.value = 0;
      node.connect(bq);
      node = bq;
      return bq;
    });
    node.connect(masterGain);
    masterGain.connect(ctx.destination);
    applyEqFromStore();
    applyVolumeFromStore();
  }
  return audio;
}

const dbToLin = (db: number) => Math.pow(10, db / 20);

export function applyEqFromStore() {
  const { settings } = useAppStore.getState();
  if (!ctx || !preamp || !filters.length) return;
  const enabled = settings.eqEnabled;
  preamp.gain.value = dbToLin(enabled ? settings.eqPreamp : 0);
  filters.forEach((f, i) => {
    f.gain.value = enabled ? (settings.eqBands[i] ?? 0) : 0;
  });
}

export function applyVolumeFromStore() {
  const { volume, muted } = useAppStore.getState();
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : volume;
  }
  const v = getVideoEl();
  if (v) {
    v.volume = muted ? 0 : volume;
    v.muted = muted;
  }
}

function currentTrack(): Track | undefined {
  const s = useAppStore.getState();
  return s.tracks.find((t) => t.id === s.currentTrackId);
}

/** The element currently owning playback — video for video files. */
function activeMedia(): HTMLMediaElement | null {
  const t = currentTrack();
  if (t && isVideoPath(t.path)) return getVideoEl();
  return audio;
}

/** Send a command to the video pop-up window (see lib/videoWindow.ts). */
function sendVideoCmd(payload: Record<string, unknown>) {
  emitTo("video", "amp:video-cmd", payload).catch(() => {});
}

/** True when the current track is video AND the pop-up window owns playback. */
function videoInPopup(): boolean {
  const s = useAppStore.getState();
  const t = s.tracks.find((x) => x.id === s.currentTrackId);
  return !!t && isVideoPath(t.path) && s.videoPopupOpen;
}

export async function setOutputDevice(deviceId: string) {
  if (!ctx) return;
  const anyCtx = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (anyCtx.setSinkId) {
    try {
      await anyCtx.setSinkId(deviceId === "default" ? "" : deviceId);
    } catch (e) {
      console.warn("setSinkId failed", e);
      useAppStore
        .getState()
        .setPlaybackError("Could not switch audio output device; using system default.");
    }
  } else {
    useAppStore
      .getState()
      .setPlaybackError("Output device selection is not supported by this audio engine.");
  }
}

export async function setMicMonitoring(enabled: boolean, deviceId: string) {
  // Monitoring only — plays the input through the output device. Not a recorder.
  if (!ctx) getAudio();
  if (enabled && !navigator.mediaDevices?.getUserMedia) {
    useAppStore
      .getState()
      .setPlaybackError(
        "Microphone capture is not available in this window. It requires the packaged app with mic permission granted.",
      );
    useAppStore.getState().updateSettings({ micMonitoring: false });
    return;
  }
  if (!enabled) {
    micSource?.disconnect();
    micGain?.disconnect();
    micStream?.getTracks().forEach((t) => t.stop());
    micSource = null;
    micGain = null;
    micStream = null;
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId === "default" ? true : { deviceId: { exact: deviceId } },
    });
    micSource = ctx!.createMediaStreamSource(micStream);
    micGain = ctx!.createGain();
    micGain.gain.value = 0.9; // conservative to reduce feedback
    micSource.connect(micGain);
    micGain.connect(ctx!.destination);
  } catch (e) {
    useAppStore
      .getState()
      .setPlaybackError(`Microphone input unavailable: ${e instanceof Error ? e.message : e}`);
    useAppStore.getState().updateSettings({ micMonitoring: false });
  }
}

function bindAudioEvents() {
  if (listenersBound || !audio) return;
  listenersBound = true;
  const store = () => useAppStore.getState();

  audio.addEventListener("timeupdate", () => {
    store().setPosition(audio!.currentTime);
  });
  audio.addEventListener("ended", () => {
    const s = store();
    if (s.repeat === "one") {
      audio!.currentTime = 0;
      audio!.play().catch(() => {});
      return;
    }
    next();
  });
  audio.addEventListener("error", handleMediaError);
  audio.addEventListener("playing", () => updateMediaSessionPlayback("playing"));
  audio.addEventListener("pause", () => updateMediaSessionPlayback("paused"));
}

// Tracks we've already retried via each fallback path (per session)
const convertRetries = new Set<string>();
// Tracks that only play via the IPC Blob transport — skip the media-server
// URL entirely on future plays.
const blobPreferred = new Set<string>();

/** Pull the file's bytes over IPC and play from a Blob URL — no localhost
 *  server involved, so firewalls/AV can't break playback. */
export async function playViaBlob(
  el: HTMLMediaElement,
  path: string,
): Promise<boolean> {
  try {
    const buf = await invoke<ArrayBuffer>("read_media_file", { path });
    el.src = URL.createObjectURL(new Blob([buf]));
    el.load();
    await el.play().catch(() => {});
    blobPreferred.add(path);
    const s = useAppStore.getState();
    s.setIsPlaying(true);
    updateMediaSessionPlayback("playing");
    return true;
  } catch {
    return false;
  }
}

async function handleMediaError(e: Event) {
  const el = e.currentTarget as HTMLMediaElement;
  // MEDIA_ERR_ABORTED fires when a new src replaces an in-flight load or a
  // pause() interrupts one — benign, not a real playback failure.
  if (!el.src || !el.error || el.error.code === MediaError.MEDIA_ERR_ABORTED) {
    return;
  }
  const s = useAppStore.getState();
  const t = s.tracks.find((x) => x.id === s.currentTrackId);
  if (!t) return;

  // Stage 1 — server unreachable (firewall/AV): stream via IPC Blob.
  // Skip when the element is already playing a blob: source (it genuinely
  // failed, not a transport problem).
  if (!el.src.startsWith("blob:") && (await playViaBlob(el, t.path))) {
    s.setPlaybackError(null);
    return;
  }

  // Stage 2 — undecodable audio (e.g. ALAC-in-m4a on WebView2): transcode
  // to MP3 once with the bundled ffmpeg and play that.
  if (!convertRetries.has(t.id) && !isVideoPath(t.path)) {
    convertRetries.add(t.id);
    s.setPlaybackError(`"${t.title}" uses an unsupported codec — converting to MP3…`);
    try {
      const mp3 = await invoke<string>("convert_to_mp3", { path: t.path });
      if (await playViaBlob(el, mp3)) {
        s.setPlaybackError(null);
        return;
      }
      el.src = mediaUrl(mp3);
      el.load();
      el.play().catch(() => {});
      return;
    } catch {
      // fall through to generic error
    }
  }

  s.setPlaybackError(
    `Could not play "${t.title}". The file may be missing, moved, or in an unsupported format. ` +
      `Check that ${t.path} exists and is a readable MP3/FLAC/WAV/AAC/M4A/MP4/MOV file.`,
  );
  s.updateTrack(t.id, { missing: true });
  s.setIsPlaying(false);
  updateMediaSessionPlayback("paused");
}

function bindVideoEvents(el: HTMLVideoElement) {
  if (videoListenersBound) return;
  videoListenersBound = true;
  const store = () => useAppStore.getState();

  el.addEventListener("timeupdate", () => {
    store().setPosition(el.currentTime);
  });
  el.addEventListener("ended", () => {
    const s = store();
    if (s.repeat === "one") {
      el.currentTime = 0;
      el.play().catch(() => {});
      return;
    }
    next();
  });
  el.addEventListener("error", handleMediaError);
  el.addEventListener("playing", () => updateMediaSessionPlayback("playing"));
  el.addEventListener("pause", () => updateMediaSessionPlayback("paused"));
}

/** Called by VideoOverlay when its <video> element mounts/unmounts. */
export function registerVideoElement(el: HTMLVideoElement | null) {
  videoEl = el;
  if (el) {
    bindVideoEvents(el);
    applyVolumeFromStore();
  }
}

/**
 * Get the video element, lazily re-finding it in the DOM if registration
 * was lost (e.g. this module hot-reloaded while the component stayed
 * mounted). Returns null when the overlay isn't mounted.
 */
function getVideoEl(): HTMLVideoElement | null {
  if (videoEl) return videoEl;
  const el = document.querySelector<HTMLVideoElement>("video[data-amp-video]");
  if (el) {
    videoEl = el;
    bindVideoEvents(el);
    applyVolumeFromStore();
  }
  return el;
}

function updateMediaSessionPlayback(state: MediaSessionPlaybackState) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = state;
  }
}

async function updateMediaSessionMetadata(track: Track) {
  if (!("mediaSession" in navigator)) return;
  let artwork: MediaImage[] = [];
  try {
    const cover = await invoke<{ mime: string; base64: string } | null>("read_cover", {
      path: track.path,
    });
    if (cover) {
      artwork = [
        { src: `data:${cover.mime};base64,${cover.base64}`, sizes: "512x512", type: cover.mime },
      ];
    }
  } catch {
    /* no cover */
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || "Unknown artist",
    album: track.album || "",
    artwork,
  });
}

function bindMediaSessionActions() {
  if (!("mediaSession" in navigator)) return;
  const s = useAppStore.getState;
  navigator.mediaSession.setActionHandler("play", () => play());
  navigator.mediaSession.setActionHandler("pause", () => pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => prev());
  navigator.mediaSession.setActionHandler("nexttrack", () => next());
  navigator.mediaSession.setActionHandler("seekto", (d) => {
    const el = activeMedia();
    if (el && d.seekTime != null) {
      el.currentTime = d.seekTime;
      s().setPosition(d.seekTime);
    }
  });
}

export async function playTrack(track: Track) {
  const s = useAppStore.getState;
  bindMediaSessionActions();

  // Report the stored path so mismatches (e.g. OneDrive-redirected
  // folders) are visible instead of a generic load error.
  const exists = await invoke<boolean>("file_exists", {
    path: track.path,
  }).catch(() => true);
  if (!exists) {
    s().updateTrack(track.id, { missing: true });
    s().setPlaybackError(`File not found — ${track.path}`);
    return;
  }

  const video = isVideoPath(track.path);

  if (video && s().videoPopupOpen) {
    // The pop-up window owns the <video> element — hand it the file.
    audio?.pause();
    videoEl?.pause();
    sendVideoCmd({ cmd: "load", path: track.path, position: 0, autoplay: true });
    s().setCurrentTrack(track.id);
    s().setPosition(0);
    s().setPlaybackError(null);
    s().updateTrack(track.id, { missing: false });
    s().setIsPlaying(true);
    s().incrementPlayCount(track.id);
    s().addHistoryEntry({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      playedAt: Date.now(),
    });
    updateMediaSessionMetadata(track);
    updateMediaSessionPlayback("playing");
    return;
  }

  const el: HTMLMediaElement | null = video ? getVideoEl() : getAudio();
  if (!el) {
    s().setPlaybackError("The video player is not ready yet — try again.");
    return;
  }
  if (video) {
    audio?.pause();
  } else {
    {
      const vel = getVideoEl();
      if (vel && !vel.paused) {
        // Smooth fade-out before handing over to the song
        rampVolume(vel, 0, () => {
          vel.pause();
          vel.volume = s().volume;
        });
      } else {
        vel?.pause();
      }
      if (s().videoPopupOpen) sendVideoCmd({ cmd: "fadeout" });
    }
    bindAudioEvents();
  }

  // Tracks that only play over IPC Blob skip the media-server URL.
  const useBlob = blobPreferred.has(track.path);
  if (!useBlob) {
    el.src = mediaUrl(track.path);
    el.currentTime = 0;
  }
  s().setCurrentTrack(track.id);
  s().setPosition(0);
  s().setPlaybackError(null);
  s().updateTrack(track.id, { missing: false });
  // Log the play now — if the transport fails and a fallback kicks in,
  // the history entry still lands.
  s().incrementPlayCount(track.id);
  s().addHistoryEntry({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    playedAt: Date.now(),
  });
  updateMediaSessionMetadata(track);

  if (ctx?.state === "suspended") await ctx.resume().catch(() => {});
  try {
    if (useBlob) {
      if (!(await playViaBlob(el, track.path))) throw new Error("blob failed");
    } else {
      await el.play();
    }
    s().setIsPlaying(true);
    updateMediaSessionPlayback("playing");
  } catch (e) {
    s().setIsPlaying(false);
    s().setPlaybackError(
      `Playback failed for "${track.title}": ${e instanceof Error ? e.message : e}`,
    );
  }
}

let fadeTimer: ReturnType<typeof setInterval> | null = null;

/** Ramp a media element's volume toward `target` over ~1.5s. */
function rampVolume(el: HTMLMediaElement, target: number, done?: () => void) {
  if (fadeTimer) clearInterval(fadeTimer);
  const steps = 30;
  const start = el.volume;
  let i = 0;
  fadeTimer = setInterval(() => {
    i++;
    el.volume = Math.min(
      1,
      Math.max(0, start + (target - start) * (i / steps)),
    );
    if (i >= steps) {
      clearInterval(fadeTimer!);
      fadeTimer = null;
      done?.();
    }
  }, 50);
}

/** Fade toggle — smoothly fades the current song out then pauses; press
 *  again to fade back in. */
export function fadeToggle() {
  const s = useAppStore.getState();
  const el = getAudio();
  if (!el || !el.src) return;
  if (s.isPlaying) {
    rampVolume(el, 0, () => {
      el.pause();
      el.volume = s.volume; // restore level for the next play
    });
    s.setIsPlaying(false);
    updateMediaSessionPlayback("paused");
  } else {
    el.volume = 0;
    el.play().catch(() => {});
    rampVolume(el, s.volume);
    s.setIsPlaying(true);
    updateMediaSessionPlayback("playing");
  }
}

export function play() {
  const s = useAppStore.getState();
  if (videoInPopup()) {
    sendVideoCmd({ cmd: "play" });
    s.setIsPlaying(true);
    return;
  }
  const el = activeMedia();
  if (!el?.src) {
    const t = s.tracks.find((x) => x.id === s.currentTrackId) ?? s.tracks[0];
    if (t) return playTrack(t);
    return;
  }
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
  el.play().then(() => s.setIsPlaying(true)).catch(() => {});
}

export function pause() {
  if (videoInPopup()) {
    sendVideoCmd({ cmd: "pause" });
  } else {
    activeMedia()?.pause();
  }
  useAppStore.getState().setIsPlaying(false);
}

export function seek(seconds: number) {
  if (videoInPopup()) {
    sendVideoCmd({ cmd: "seek", value: seconds });
    useAppStore.getState().setPosition(seconds);
    return;
  }
  const el = activeMedia();
  if (el) {
    el.currentTime = seconds;
    useAppStore.getState().setPosition(seconds);
  }
}

function queueIndex(s: ReturnType<typeof useAppStore.getState>): number {
  return s.queue.indexOf(s.currentTrackId ?? "");
}

export function next() {
  const s = useAppStore.getState();
  if (!s.queue.length) return;
  const i = queueIndex(s);
  let nextId: string | undefined;
  if (s.shuffle) {
    const others = s.queue.filter((id) => id !== s.currentTrackId);
    nextId = others[Math.floor(Math.random() * others.length)];
  } else {
    nextId = s.queue[i + 1] ?? (s.repeat === "all" ? s.queue[0] : undefined);
  }
  if (!nextId) {
    s.setIsPlaying(false);
    activeMedia()?.pause();
    return;
  }
  const t = s.tracks.find((x) => x.id === nextId);
  if (t) playTrack(t);
}

export function prev() {
  const s = useAppStore.getState();
  // Standard behavior: >3s in restarts the track
  if (s.position > 3) {
    seek(0);
    return;
  }
  const i = queueIndex(s);
  const prevId = s.queue[i - 1] ?? (s.repeat === "all" ? s.queue[s.queue.length - 1] : undefined);
  const t = prevId ? s.tracks.find((x) => x.id === prevId) : undefined;
  if (t) playTrack(t);
  else seek(0);
}

export function getAudioElement() {
  return audio;
}

export function getVideoElement() {
  return getVideoEl();
}
