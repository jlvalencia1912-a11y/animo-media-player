import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Youtube, Link2, FolderOpen, AlertTriangle, Info, Loader2, Download } from "lucide-react";
import { useAppStore } from "../store";
import { Modal } from "./Modal";
import { scanFiles, addFilesAsTracks } from "../lib/library";

type Status =
  | { kind: "idle" }
  | { kind: "youtube" }
  | { kind: "direct" }
  | { kind: "other" }
  | { kind: "invalid" };

const YT_RE =
  /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;

/** Resolution choices mapped to yt-dlp format selectors. Prefers separate
 *  mp4 video + m4a audio streams merged by the bundled ffmpeg — muxed
 *  progressive MP4 only exists at 360p on YouTube. */
const RESOLUTIONS: { label: string; format: string }[] = [
  { label: "Best available", format: "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b" },
  {
    label: "1080p",
    format: "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba/b",
  },
  {
    label: "720p",
    format: "bv*[ext=mp4][height<=720]+ba[ext=m4a]/bv*[height<=720]+ba/b",
  },
  {
    label: "480p",
    format: "bv*[ext=mp4][height<=480]+ba[ext=m4a]/bv*[height<=480]+ba/b",
  },
];
const AUDIO_EXT_RE = /\.(mp3|flac|wav|aac|m4a)([?#].*)?$/i;

function classify(url: string): Status {
  const trimmed = url.trim();
  if (!trimmed) return { kind: "idle" };
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { kind: "invalid" };
  }
  if (!/^https?:$/i.test(parsed.protocol)) return { kind: "invalid" };
  if (YT_RE.test(trimmed)) return { kind: "youtube" };
  if (AUDIO_EXT_RE.test(parsed.pathname)) return { kind: "direct" };
  return { kind: "other" };
}

export function AddFromLinkDialog() {
  const { showLinkDialog, setShowLinkDialog, setShowNewSongs } = useAppStore();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);
  const [dlPercent, setDlPercent] = useState<number | null>(null);
  const [resIdx, setResIdx] = useState(0);

  useEffect(() => {
    const un = listen<number>("amp:dl-progress", (e) =>
      setDlPercent(e.payload),
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  const check = () => setStatus(classify(url));
  const close = () => {
    setUrl("");
    setStatus({ kind: "idle" });
    setDlError(null);
    setShowLinkDialog(false);
  };

  const downloadVideo = async () => {
    setDownloading(true);
    setDlError(null);
    setDlPercent(null);
    try {
      const path = await invoke<string>("download_youtube", {
        url: url.trim(),
        format: RESOLUTIONS[resIdx].format,
      });
      const result = await scanFiles([path]);
      if (!result.files.length) {
        setDlError("Downloaded, but the file could not be read.");
        return;
      }
      await addFilesAsTracks(result.files, "videos");
      const s = useAppStore.getState();
      s.moveTracksToSection(
        result.files.map((f) => f.path),
        "videos",
      );
      s.setView({ kind: "videos" });
      close();
    } catch (e) {
      setDlError(String(e));
    } finally {
      setDownloading(false);
    }
  };
  const addLocalInstead = () => {
    close();
    setShowNewSongs(true);
  };

  return (
    <Modal open={showLinkDialog} title="Add from a link" onClose={close}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Paste a link to check whether Animo can import it.
        </p>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setStatus({ kind: "idle" });
              }}
              onKeyDown={(e) => e.key === "Enter" && check()}
              placeholder="https://…"
              aria-label="Media link URL"
              autoFocus
              className="h-10 w-full rounded-lg border border-border bg-surface-elevated pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none"
            />
          </div>
          <button
            onClick={check}
            disabled={!url.trim()}
            className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-50"
          >
            Check link
          </button>
        </div>

        {status.kind === "invalid" && (
          <p role="alert" className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            That doesn't look like a valid web address. Check the URL and try
            again.
          </p>
        )}

        {status.kind === "youtube" && (
          <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm">
            <Youtube className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div className="flex-1 text-foreground/90">
              <p className="font-medium text-foreground">YouTube video</p>
              <p className="mt-1 text-muted-foreground">
                Downloads the video as an MP4 and adds it to your Videos
                library. Files are saved to{" "}
                <strong>~/Desktop/Animo Downloads</strong>.
              </p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Only download videos you have the right to use.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <select
                  value={resIdx}
                  onChange={(e) => setResIdx(Number(e.target.value))}
                  disabled={downloading}
                  aria-label="Download resolution"
                  className="h-9 rounded-lg border border-border bg-surface-elevated px-2.5 text-sm text-foreground focus:border-accent focus:outline-none"
                >
                  {RESOLUTIONS.map((r, i) => (
                    <option key={r.label} value={i} className="bg-surface-elevated">
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={downloadVideo}
                  disabled={downloading}
                  className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-50"
                >
                  {downloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {dlPercent != null
                        ? `Downloading… ${Math.floor(dlPercent)}%`
                        : "Preparing…"}
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download video
                    </>
                  )}
                </button>
              </div>
              {downloading && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-elevated">
                  <div
                    className={`h-full bg-accent transition-all ${dlPercent == null ? "animate-pulse" : ""}`}
                    style={{ width: `${Math.max(dlPercent ?? 10, 5)}%` }}
                  />
                </div>
              )}
              {dlError && (
                <p role="alert" className="mt-2 whitespace-pre-line text-xs text-warning">
                  {dlError}
                </p>
              )}
            </div>
          </div>
        )}

        {status.kind === "direct" && (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-elevated p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="text-muted-foreground">
              This looks like a direct link to an audio file, but Animo doesn't
              fetch remote media — your library is local files only. If you're
              authorized to use this audio, download it in your browser first,
              then add it with <strong>Add a local file</strong>.
            </p>
          </div>
        )}

        {status.kind === "other" && (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-elevated p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p className="text-muted-foreground">
              Animo plays local audio files (MP3, FLAC, WAV, AAC, M4A) — it
              can't pull media from streaming or video sites. If you lawfully
              have this audio as a file, add it with{" "}
              <strong>Add a local file</strong>.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Supported: local MP3, FLAC, WAV, AAC, M4A, MP4/MOV/M4V/WEBM files ·
            YouTube downloads as MP4.
          </p>
          <button
            onClick={addLocalInstead}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition hover:bg-surface-hover"
          >
            <FolderOpen className="h-4 w-4" />
            Add a local file
          </button>
        </div>
      </div>
    </Modal>
  );
}
