import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { Track } from "../types";

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
  audio.addEventListener("error", () => {
    const s = store();
    const t = s.tracks.find((x) => x.id === s.currentTrackId);
    if (!t) return;
    s.setPlaybackError(
      `Could not play "${t.title}". The file may be missing, moved, or in an unsupported format. ` +
        `Check that ${t.path} exists and is a readable MP3/FLAC/WAV/AAC/M4A file.`,
    );
    s.updateTrack(t.id, { missing: true });
    s.setIsPlaying(false);
    updateMediaSessionPlayback("paused");
  });
  audio.addEventListener("playing", () => updateMediaSessionPlayback("playing"));
  audio.addEventListener("pause", () => updateMediaSessionPlayback("paused"));
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
    if (audio && d.seekTime != null) {
      audio.currentTime = d.seekTime;
      s().setPosition(d.seekTime);
    }
  });
}

export async function playTrack(track: Track) {
  const s = useAppStore.getState;
  const el = getAudio();
  bindAudioEvents();
  bindMediaSessionActions();

  el.src = convertFileSrc(track.path);
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
  if (!audio?.src) {
    const t = s.tracks.find((x) => x.id === s.currentTrackId) ?? s.tracks[0];
    if (t) return playTrack(t);
    return;
  }
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
  audio.play().then(() => s.setIsPlaying(true)).catch(() => {});
}

export function pause() {
  audio?.pause();
  useAppStore.getState().setIsPlaying(false);
}

export function seek(seconds: number) {
  if (audio) {
    audio.currentTime = seconds;
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
    audio?.pause();
    return;
  }
  const t = s.tracks.find((x) => x.id === nextId);
  if (t) playTrack(t);
}

export function prev() {
  const s = useAppStore.getState();
  // Standard behavior: >3s in restarts the track
  if (audio && audio.currentTime > 3) {
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
