import { useState } from "react";
import { Youtube, Link2, FolderOpen, AlertTriangle, Info } from "lucide-react";
import { useAppStore } from "../store";
import { Modal } from "./Modal";

type Status =
  | { kind: "idle" }
  | { kind: "youtube" }
  | { kind: "direct" }
  | { kind: "other" }
  | { kind: "invalid" };

const YT_RE =
  /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i;
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

  const check = () => setStatus(classify(url));
  const close = () => {
    setUrl("");
    setStatus({ kind: "idle" });
    setShowLinkDialog(false);
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
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm"
          >
            <Youtube className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="text-foreground/90">
              <p className="font-medium text-foreground">
                YouTube links can't be imported
              </p>
              <p className="mt-1 text-muted-foreground">
                YouTube's Terms of Service don't allow extracting or
                downloading audio from videos unless YouTube or the rights
                holder provides a download option, so Animo doesn't download
                from YouTube links.
              </p>
              <p className="mt-1 text-muted-foreground">
                If you own or have lawfully obtained the audio file, add it
                with <strong>Add a local file</strong> below.
              </p>
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
            Supported: local MP3, FLAC, WAV, AAC, M4A files.
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
