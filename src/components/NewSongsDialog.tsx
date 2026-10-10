import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FilePlus2, Loader2 } from "lucide-react";
import { useAppStore } from "../store";
import { Modal } from "./Modal";
import { scanFiles, addFilesAsTracks, type ScannedFile } from "../lib/library";
import { AUDIO_EXTENSIONS } from "../types";

interface Row {
  file: ScannedFile;
  title: string;
  trackNumber: string;
}

export function NewSongsDialog() {
  const { showNewSongs, setShowNewSongs, sections } = useAppStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [sectionId, setSectionId] = useState("new-songs");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFiles = async () => {
    setError(null);
    const picked = await open({
      multiple: true,
      filters: [{ name: "Audio", extensions: [...AUDIO_EXTENSIONS] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    setBusy(true);
    try {
      const files = await scanFiles(paths);
      if (files.length === 0) {
        setError("No readable audio files were selected.");
        return;
      }
      setRows((prev) => [
        ...prev,
        ...files
          .filter((f) => !prev.some((r) => r.file.path === f.path))
          .map((f) => ({
            file: f,
            title: f.title,
            trackNumber: f.trackNumber != null ? String(f.trackNumber) : "",
          })),
      ]);
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (path: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.file.path === path ? { ...r, ...patch } : r)));

  const addAll = async () => {
    if (!rows.length) return;
    const overrides = new Map(
      rows.map((r) => [
        r.file.path,
        {
          title: r.title.trim() || r.file.title,
          trackNumber: r.trackNumber.trim() === "" ? null : Number(r.trackNumber) || null,
        },
      ]),
    );
    await addFilesAsTracks(
      rows.map((r) => r.file),
      sectionId,
      overrides,
    );
    setRows([]);
    setShowNewSongs(false);
  };

  const close = () => {
    setRows([]);
    setShowNewSongs(false);
  };

  return (
    <Modal open={showNewSongs} title="New Songs — add tracks" onClose={close} wide>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={pickFiles}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}
            Choose audio files
          </button>
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            aria-label="Section"
            className="ml-auto rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            {sections
              .filter((s) => !s.parentId)
              .flatMap((s) => [
                s,
                ...sections.filter((c) => c.parentId === s.id),
              ])
              .map((s) => (
                <option key={s.id} value={s.id} className="bg-surface-elevated">
                  {s.parentId ? " " : ""}{s.name}
                </option>
              ))}
          </select>
        </div>
        {error && <p className="text-sm text-warning">{error}</p>}

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Select MP3, FLAC, WAV, AAC, or M4A files. You can adjust each track
            number and title before adding them to the section.
          </p>
        ) : (
          <>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-16 px-3 py-2 font-medium">Track #</th>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="w-56 px-3 py-2 font-medium">File</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.file.path} className="border-b border-border/40">
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          min={0}
                          value={r.trackNumber}
                          onChange={(e) => updateRow(r.file.path, { trackNumber: e.target.value })}
                          aria-label={`Track number for ${r.file.fileName}`}
                          className="w-14 rounded border border-border bg-surface-elevated px-2 py-1 text-sm focus:border-accent focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={r.title}
                          onChange={(e) => updateRow(r.file.path, { title: e.target.value })}
                          aria-label={`Title for ${r.file.fileName}`}
                          className="w-full rounded border border-border bg-surface-elevated px-2 py-1 text-sm focus:border-accent focus:outline-none"
                        />
                      </td>
                      <td className="max-w-0 truncate px-3 py-1.5 text-xs text-muted-foreground" title={r.file.path}>
                        {r.file.fileName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={close}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={addAll}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover"
              >
                Add {rows.length} track{rows.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
