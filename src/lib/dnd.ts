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

const sameTarget = (a: DropTarget | null, b: DropTarget | null) =>
  a?.kind === b?.kind &&
  (!a || !b || !("id" in a) || ("id" in b && a.id === b.id));

function targetFromPoint(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
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
    const resolved = resolveDropTarget(target);
    if (resolved.kind === "section") {
      s.moveTracksToSection(ids, resolved.id);
      s.setView({ kind: "section", id: resolved.id });
    } else {
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
  const resolved = resolveDropTarget(target);
  // Dropping on the generic views (All Songs, Recents) has no section of
  // its own — audio lands in New Songs and video in Videos.
  const genericView =
    target.kind === "view" &&
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

  // Destination section per file; drops onto a specific section (or while
  // viewing one) honor that section for everything.
  const destFor = (f: ScannedFile): string => {
    if (resolved.kind === "playlist") {
      return isVideoPath(f.path) ? "videos" : "new-songs";
    }
    if (genericView && isVideoPath(f.path)) return "videos";
    return resolved.id;
  };

  const byDest = new Map<string, ScannedFile[]>();
  for (const f of files) {
    const d = destFor(f);
    byDest.set(d, [...(byDest.get(d) ?? []), f]);
  }
  for (const [dest, group] of byDest) {
    await addFilesAsTracks(group, dest);
    if (resolved.kind === "section") {
      // Files already in the library get moved to the drop section too.
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
    // Show the section most files landed in.
    const primary = byDest.has(resolved.id)
      ? resolved.id
      : [...byDest.keys()][0];
    useAppStore.getState().setView({ kind: "section", id: primary });
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
