// Drag & drop helpers.
//
// Two flavors are supported:
//   1. Internal drags — tracks dragged from the track list onto a sidebar
//      section (moves them) or playlist (adds them). Implemented with pointer
//      events instead of HTML5 DnD because WKWebView does not reliably fire
//      drags started on table rows.
//   2. OS file drops — files/folders dragged from Finder/Explorer anywhere
//      onto the app. Tauri intercepts these (dragDropEnabled) and reports
//      them through onDragDropEvent with physical-pixel positions, so the
//      drop target is found by hit-testing the DOM at the cursor position.
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useAppStore, type DropTarget } from "../store";
import {
  scanFiles,
  scanFoldersRaw,
  addFilesAsTracks,
  type ScannedFile,
} from "./library";
import { isMediaPath, isVideoPath } from "../types";

/** Resolve "view" to the concrete section/playlist currently on screen. */
export function resolveDropTarget(
  t: DropTarget,
): Exclude<DropTarget, { kind: "view" }> {
  if (t.kind !== "view") return t;
  const v = useAppStore.getState().view;
  if (v.kind === "section") return { kind: "section", id: v.id };
  if (v.kind === "playlist") return { kind: "playlist", id: v.id };
  return { kind: "section", id: "new-songs" };
}

const sameTarget = (a: DropTarget | null, b: DropTarget | null) => {
  if (a?.kind !== b?.kind) return false;
  if (!a || !b) return true;
  if (a.kind === "reorder" && b.kind === "reorder")
    return a.beforeId === b.beforeId;
  if ("id" in a && "id" in b) return a.id === b.id;
  return true;
};

function targetFromPoint(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  const row = el?.closest<HTMLElement>("[data-reorder-before]");
  if (row) {
    return { kind: "reorder", beforeId: row.dataset.reorderBefore || null };
  }
  const hit = el?.closest<HTMLElement>(
    "[data-drop-section],[data-drop-playlist],[data-drop-view]",
  );
  if (!hit) return null;
  if (hit.dataset.dropSection)
    return { kind: "section", id: hit.dataset.dropSection };
  if (hit.dataset.dropPlaylist)
    return { kind: "playlist", id: hit.dataset.dropPlaylist };
  return { kind: "view" };
}

/**
 * Begin an internal track drag (pointer-based). Call from a pointerdown
 * handler on the drag handle; the drag starts after the pointer travels a
 * few pixels so plain clicks are unaffected.
 */
export function startTrackDrag(ids: string[], startX: number, startY: number) {
  let dragging = false;

  const onMove = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 6) {
        return;
      }
      dragging = true;
      document.body.classList.add("track-dragging");
    }
    const s = useAppStore.getState();
    s.setTrackDrag({ ids, x: e.clientX, y: e.clientY });
    const t = targetFromPoint(e.clientX, e.clientY);
    if (!sameTarget(t, s.dropTarget)) s.setDropTarget(t);
  };

  const finish = (e?: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    document.body.classList.remove("track-dragging");
    const s = useAppStore.getState();
    s.setTrackDrag(null);
    s.setDropTarget(null);
    if (!dragging || !e) return;
    const target = targetFromPoint(e.clientX, e.clientY);
    if (!target) return;
    if (target.kind === "reorder") {
      const v = s.view;
      if (v.kind === "section") {
        s.reorderSectionTracks(v.id, ids, target.beforeId);
      }
      return;
    }
    const resolved = resolveDropTarget(target);
    if (resolved.kind === "section") {
      s.moveTracksToSection(ids, resolved.id);
      s.setView({ kind: "section", id: resolved.id });
    } else if (resolved.kind === "playlist") {
      s.addTracksToPlaylist(resolved.id, ids);
      s.setView({ kind: "playlist", id: resolved.id });
    }
  };

  const onUp = (e: PointerEvent) => finish(e);
  const onCancel = () => finish();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}

/** Import OS-dropped paths (files and/or folders) into a section or playlist. */
export async function importPathsToTarget(
  paths: string[],
  target: DropTarget,
): Promise<void> {
  const store = useAppStore.getState();
  // A reorder row only makes sense for track drags — treat OS file drops
  // on the list as drops on the current view.
  const t = target.kind === "reorder" ? ({ kind: "view" } as const) : target;
  const resolved = resolveDropTarget(t);
  // Dropping on the generic views (All Songs, Recents) has no section of
  // its own — audio lands in New Songs and video stays unsectioned (it
  // still shows up under All Videos).
  const genericView =
    t.kind === "view" &&
    !["section", "playlist"].includes(store.view.kind);

  const media = paths.filter(isMediaPath);
  const rest = paths.filter((p) => !isMediaPath(p));

  const files: ScannedFile[] = [];
  store.setScanning(true);
  try {
    if (media.length) files.push(...(await scanFiles(media)).files);
    // Anything without a media extension might be a folder — try it.
    if (rest.length) files.push(...(await scanFoldersRaw(rest)).files);
  } finally {
    useAppStore.getState().setScanning(false);
  }
  if (!files.length) return;

  // Destination section per file (null = unsectioned); drops onto a
  // specific section (or while viewing one) honor that section for
  // everything. Ordered sections get the files added to their list (see
  // addFilesAsTracks) while audio keeps New Songs as its home section.
  const destFor = (f: ScannedFile): string | null => {
    if (resolved.kind === "playlist") {
      return isVideoPath(f.path) ? null : "new-songs";
    }
    if (genericView && isVideoPath(f.path)) return null;
    return resolved.kind === "section" ? resolved.id : null;
  };

  const byDest = new Map<string | null, ScannedFile[]>();
  for (const f of files) {
    const d = destFor(f);
    byDest.set(d, [...(byDest.get(d) ?? []), f]);
  }
  for (const [dest, group] of byDest) {
    await addFilesAsTracks(group, dest);
    if (dest && resolved.kind === "section") {
      // Files already in the library get moved/copied to the drop section too.
      useAppStore.getState().moveTracksToSection(
        group.map((f) => f.path),
        dest,
      );
    }
  }

  const allIds = files.map((f) => f.path);
  if (resolved.kind === "playlist") {
    store.addTracksToPlaylist(resolved.id, allIds);
    useAppStore.getState().setView({ kind: "playlist", id: resolved.id });
  } else {
    // Show the section most files landed in (unsectioned-only drops —
    // videos — show the All Videos view).
    const primary =
      resolved.kind === "section" && byDest.has(resolved.id)
        ? resolved.id
        : [...byDest.keys()][0];
    useAppStore
      .getState()
      .setView(
        primary ? { kind: "section", id: primary } : { kind: "videos" },
      );
  }
}

/**
 * Listen for OS file drops on this webview. Positions arrive in physical
 * pixels; elementFromPoint wants CSS pixels, so divide by devicePixelRatio.
 * Returns a cleanup function.
 */
export function startFileDropListener(): () => void {
  let active = true;
  const unlisten = getCurrentWebview().onDragDropEvent((e) => {
    const s = useAppStore.getState();
    const scale = window.devicePixelRatio || 1;
    if (e.payload.type === "enter" || e.payload.type === "over") {
      const { x, y } = e.payload.position;
      const next = targetFromPoint(x / scale, y / scale);
      if (!sameTarget(next, s.dropTarget)) s.setDropTarget(next);
    } else if (e.payload.type === "drop") {
      const { x, y } = e.payload.position;
      const target = targetFromPoint(x / scale, y / scale);
      s.setDropTarget(null);
      if (target) {
        importPathsToTarget(e.payload.paths, target).catch((err) =>
          useAppStore
            .getState()
            .setPlaybackError(`Import failed: ${String(err)}`),
        );
      }
    } else {
      s.setDropTarget(null);
    }
  });
  return () => {
    if (!active) return;
    active = false;
    unlisten.then((f) => f()).catch(() => {});
  };
}
