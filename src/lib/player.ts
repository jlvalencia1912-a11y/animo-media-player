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

function handleMediaError(e: Event) {
  const el = e.currentTarget as HTMLMediaElement;
  // MEDIA_ERR_ABORTED fires when a new src replaces an in-flight load or a
  // pause() interrupts one — benign, not a real playback failure.
  if (!el.src || !el.error || el.error.code === MediaError.MEDIA_ERR_ABORTED) {
    return;
  }
  const s = useAppStore.getState();
  const t = s.tracks.find((x) => x.id === s.currentTrackId);
  if (!t) return;
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
    getVideoEl()?.pause();
    bindAudioEvents();
  }

  el.src = mediaUrl(track.path);
  el.currentTime = 0;
  s().setCurrentTrack(track.id);
  s().setPosition(0);
  s().setPlaybackError(null);
  s().updateTrack(track.id, { missing: false });

  if (ctx?.state === "suspended") await ctx.resume().catch(() => {});
  try {
    await el.play();
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
  } catch (e) {
    s().setIsPlaying(false);
    s().setPlaybackError(
      `Playback failed for "${track.title}": ${e instanceof Error ? e.message : e}`,
    );
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
