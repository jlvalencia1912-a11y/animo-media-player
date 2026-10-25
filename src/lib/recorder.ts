// Mic recording: captures raw PCM from the chosen input via WebAudio and
// encodes it to MP3 (Mp3Encoder from lamejs) so files play on Mac and PC
// alike. The finished file is saved through a Rust command into the chosen
// recordings folder, then imported into the library's "Recordings" section.
import { invoke } from "@tauri-apps/api/core";
import { Mp3Encoder } from "@breezystack/lamejs";
import { useAppStore } from "../store";
import { scanFiles, addFilesAsTracks } from "./library";

let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let processor: ScriptProcessorNode | null = null;
let mute: GainNode | null = null;
let encoder: Mp3Encoder | null = null;
let mp3Parts: Uint8Array[] = [];

export function micCaptureAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function floatTo16BitPCM(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export async function startRecording(deviceId: string): Promise<void> {
  const s = useAppStore.getState();
  if (s.recording || processor) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "Microphone capture is not available in this window. It requires the packaged app with mic permission granted.",
    );
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio:
      deviceId && deviceId !== "default"
        ? { deviceId: { exact: deviceId } }
        : true,
  });

  audioCtx = new AudioContext();
  source = audioCtx.createMediaStreamSource(stream);
  encoder = new Mp3Encoder(1, audioCtx.sampleRate, 128); // mono, native rate, 128kbps
  mp3Parts = [];

  // ScriptProcessorNode keeps this simple and works in WKWebView. It must be
  // connected to the destination to run — routed through a zero-gain node so
  // the mic is not played back (that's what Monitor mode is for).
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    const pcm = floatTo16BitPCM(e.inputBuffer.getChannelData(0));
    const part = encoder!.encodeBuffer(pcm);
    if (part.length) mp3Parts.push(part);
  };
  mute = audioCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  s.setRecording({ startedAt: Date.now(), mime: "audio/mpeg" });
}

function teardown() {
  processor?.disconnect();
  source?.disconnect();
  mute?.disconnect();
  processor = null;
  source = null;
  mute = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  useAppStore.getState().setRecording(null);
}

export async function stopRecording(): Promise<void> {
  const enc = encoder;
  encoder = null;
  teardown();
  if (!enc) return;

  const tail = enc.flush();
  if (tail.length) mp3Parts.push(tail);
  const blob = new Blob(mp3Parts as BlobPart[], { type: "audio/mpeg" });
  mp3Parts = [];
  if (blob.size === 0) return;

  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ampm = d.getHours() >= 12 ? "PM" : "AM";
  const h12 = d.getHours() % 12 || 12;
  // recording-MM-DD-YYYY_hh-mm-ss-AM.mp3
  const fileName =
    `recording-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}` +
    `_${pad(h12)}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${ampm}.mp3`;

  const dir = useAppStore.getState().settings.recordingDir;
  const path = await invoke<string>("save_recording", {
    data: [...new Uint8Array(await blob.arrayBuffer())],
    fileName,
    dir: dir || null,
  });

  const result = await scanFiles([path]);
  if (result.files.length) {
    await addFilesAsTracks(result.files, "recordings");
    // Belt & suspenders: if the file was somehow already in the library,
    // move it into Recordings so it never leaks into All Songs.
    useAppStore
      .getState()
      .moveTracksToSection(
        result.files.map((f) => f.path),
        "recordings",
      );
    useAppStore.getState().setView({ kind: "section", id: "recordings" });
  }
}

export function discardRecording() {
  encoder = null;
  mp3Parts = [];
  teardown();
}
