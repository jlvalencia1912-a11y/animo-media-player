import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tags, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useAppStore } from "../store";
import { Modal } from "./Modal";
import { scanFiles } from "../lib/library";

interface WriteResult {
  path: string;
  ok: boolean;
  error: string | null;
}

interface FieldState {
  checked: boolean;
  value: string;
}

const FIELD_DEFS: { key: keyof Edits; label: string; placeholder: string }[] = [
  { key: "title", label: "Title", placeholder: "Leave checkbox off to keep existing" },
  { key: "artist", label: "Artist", placeholder: "Leave checkbox off to keep existing" },
  { key: "album", label: "Album", placeholder: "Leave checkbox off to keep existing" },
  { key: "trackNumber", label: "Track number", placeholder: "e.g. 3" },
  { key: "genre", label: "Genre", placeholder: "Leave checkbox off to keep existing" },
];

interface Edits {
  title: string | null;
  artist: string | null;
  album: string | null;
  trackNumber: string | null;
  genre: string | null;
}

export function TagEditorDialog() {
  const {
    showTagEditor,
    setShowTagEditor,
    tracks,
    selectedTrackIds,
    setSelectedTrackIds,
    setTracks,
  } = useAppStore();

  const selected = useMemo(
    () => tracks.filter((t) => selectedTrackIds.includes(t.id)),
    [tracks, selectedTrackIds],
  );

  const [fields, setFields] = useState<Record<string, FieldState>>({
    title: { checked: false, value: "" },
    artist: { checked: false, value: "" },
    album: { checked: false, value: "" },
    trackNumber: { checked: false, value: "" },
    genre: { checked: false, value: "" },
  });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<WriteResult[] | null>(null);

  const set = (key: string, patch: Partial<FieldState>) =>
    setFields({ ...fields, [key]: { ...fields[key], ...patch } });

  const edits: Edits = {
    title: fields.title.checked ? fields.title.value : null,
    artist: fields.artist.checked ? fields.artist.value : null,
    album: fields.album.checked ? fields.album.value : null,
    trackNumber: fields.trackNumber.checked ? fields.trackNumber.value : null,
    genre: fields.genre.checked ? fields.genre.value : null,
  };

  const anyChecked = Object.values(fields).some((f) => f.checked);

  const apply = async () => {
    if (!confirmed || !anyChecked || busy) return;
    setBusy(true);
    setResults(null);
    try {
      const res = await invoke<WriteResult[]>("write_tags", {
        paths: selected.map((t) => t.path),
        edits,
      });
      setResults(res);
      // Re-read metadata for files that succeeded so the library shows new tags
      const okPaths = res.filter((r) => r.ok).map((r) => r.path);
      if (okPaths.length) {
        const { files: fresh } = await scanFiles(okPaths);
        setTracks(
          useAppStore.getState().tracks.map((t) => {
            const f = fresh.find((x) => x.path === t.path);
            return f
              ? { ...t, title: f.title, artist: f.artist, album: f.album, trackNumber: f.trackNumber }
              : t;
          }),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setResults(null);
    setConfirmed(false);
    setShowTagEditor(false);
  };

  return (
    <Modal open={showTagEditor} title="Bulk tag editor" onClose={close} wide>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {selected.length} file{selected.length === 1 ? "" : "s"} selected.
            Checked fields are written to every selected file — unchecked
            fields and cover art are left untouched.
          </p>
          <button
            onClick={() =>
              setSelectedTrackIds(
                selected.length === tracks.length ? [] : tracks.map((t) => t.id),
              )
            }
            className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            {selected.length === tracks.length ? "Deselect all" : "Select all"}
          </button>
        </div>

        {selected.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Select tracks in the library first (checkbox column), then reopen
            the tag editor.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2">
              {FIELD_DEFS.map((f) => (
                <label
                  key={f.key}
                  className="flex items-center gap-3 rounded-lg bg-surface-elevated px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={fields[f.key].checked}
                    onChange={(e) => set(f.key, { checked: e.target.checked })}
                    className="h-4 w-4 accent-accent"
                    aria-label={`Edit ${f.label}`}
                  />
                  <span className="w-24 shrink-0 text-sm text-foreground">{f.label}</span>
                  <input
                    type="text"
                    value={fields[f.key].value}
                    disabled={!fields[f.key].checked}
                    onChange={(e) => set(f.key, { value: e.target.value })}
                    placeholder={f.placeholder}
                    aria-label={`${f.label} value`}
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm focus:border-accent focus:outline-none disabled:opacity-40"
                  />
                </label>
              ))}
            </div>

            <div className="max-h-36 overflow-y-auto rounded-lg border border-border">
              <ul className="text-xs">
                {selected.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 last:border-0"
                  >
                    <Tags className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate text-foreground/80" title={t.path}>
                      {t.fileName}
                    </span>
                    {results && (
                      <span className="ml-auto shrink-0">
                        {results.find((r) => r.path === t.path)?.ok ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <span className="flex items-center gap-1 text-danger" title={results.find((r) => r.path === t.path)?.error ?? ""}>
                            <XCircle className="h-3.5 w-3.5" />
                            {results.find((r) => r.path === t.path)?.error?.includes("not found")
                              ? "Missing"
                              : "Failed"}
                          </span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              I understand the checked tags will be written into {selected.length} file
              {selected.length === 1 ? "" : "s"} on disk. Files that are read-only
              or missing will be reported individually.
            </label>

            <div className="flex justify-end gap-2">
              <button
                onClick={close}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
              >
                Done
              </button>
              <button
                onClick={apply}
                disabled={!confirmed || !anyChecked || busy}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-40"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Write tags to {selected.length} file{selected.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
