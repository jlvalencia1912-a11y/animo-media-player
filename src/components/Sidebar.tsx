import { useState } from "react";
import {
  Library,
  Clock,
  History,
  ListMusic,
  Sparkles,
  BookOpen,
  Moon,
  Sunrise,
  Sun,
  Sunset,
  Users,
  Heart,
  Mic,
  FolderOpen,
  Settings,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useAppStore, type ViewMode } from "../store";
import type { Section } from "../types";

const ICONS: Record<string, LucideIcon> = {
  Sparkles,
  BookOpen,
  Moon,
  Sunrise,
  Sun,
  Sunset,
  Users,
  Heart,
  Mic,
};

interface ItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  indent?: boolean;
}

function NavItem({ icon: Icon, label, active, onClick, indent }: ItemProps) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
        indent ? "pl-10" : ""
      } ${
        active
          ? "bg-surface-elevated font-medium text-foreground"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-accent" : ""}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function Sidebar() {
  const {
    sections,
    playlists,
    view,
    setView,
    setShowSettings,
    setShowNewSongs,
    setShowHistory,
    createPlaylist,
    deletePlaylist,
  } = useAppStore();
  const [newPlaylist, setNewPlaylist] = useState<string | null>(null);

  const isActive = (v: ViewMode) =>
    view.kind === v.kind &&
    (!("id" in v) || ("id" in view && view.id === v.id));

  const topLevel = sections.filter((s) => !s.parentId);
  const childrenOf = (id: string) => sections.filter((s) => s.parentId === id);

  return (
    <nav
      aria-label="Library navigation"
      className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface p-3"
    >
      <div className="mb-1 px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Library
      </div>
      <NavItem icon={Library} label="All Songs" active={view.kind === "all"} onClick={() => setView({ kind: "all" })} />
      <NavItem icon={Clock} label="Recently Added" active={view.kind === "recent-added"} onClick={() => setView({ kind: "recent-added" })} />
      <NavItem icon={History} label="Recently Played" active={view.kind === "recent-played"} onClick={() => setView({ kind: "recent-played" })} />

      <div className="mb-1 mt-4 flex items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Sections</span>
        <button
          aria-label="Add songs to New Songs"
          onClick={() => setShowNewSongs(true)}
          className="rounded p-0.5 transition hover:bg-surface-hover hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {topLevel.map((section) => {
        const Icon = ICONS[section.icon] ?? ListMusic;
        const kids = childrenOf(section.id);
        return (
          <div key={section.id}>
            <NavItem
              icon={Icon}
              label={section.name}
              active={view.kind === "section" && view.id === section.id}
              onClick={() => setView({ kind: "section", id: section.id })}
            />
            {kids.map((kid) => (
              <NavItem
                key={kid.id}
                icon={ICONS[kid.icon] ?? ListMusic}
                label={kid.name}
                indent
                active={view.kind === "section" && view.id === kid.id}
                onClick={() => setView({ kind: "section", id: kid.id })}
              />
            ))}
          </div>
        );
      })}

      <div className="mb-1 mt-4 flex items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Playlists</span>
        <button
          aria-label="New playlist"
          onClick={() => setNewPlaylist("")}
          className="rounded p-0.5 transition hover:bg-surface-hover hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {newPlaylist !== null && (
        <div className="flex items-center gap-1 px-1 pb-1">
          <input
            autoFocus
            value={newPlaylist}
            onChange={(e) => setNewPlaylist(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                createPlaylist(newPlaylist);
                setNewPlaylist(null);
              }
              if (e.key === "Escape") setNewPlaylist(null);
            }}
            placeholder="Playlist name"
            aria-label="New playlist name"
            className="h-7 min-w-0 flex-1 rounded border border-border bg-surface-elevated px-2 text-xs focus:border-accent focus:outline-none"
          />
          <button
            onClick={() => {
              createPlaylist(newPlaylist);
              setNewPlaylist(null);
            }}
            className="rounded bg-accent px-2 py-1 text-xs text-accent-foreground"
          >
            Add
          </button>
        </div>
      )}
      {playlists.length === 0 && newPlaylist === null && (
        <div className="px-3 py-1 text-xs text-muted-foreground/70">
          No playlists yet
        </div>
      )}
      {playlists.map((p) => (
        <div key={p.id} className="group flex items-center">
          <div className="min-w-0 flex-1">
            <NavItem
              icon={ListMusic}
              label={p.name}
              active={view.kind === "playlist" && view.id === p.id}
              onClick={() => setView({ kind: "playlist", id: p.id })}
            />
          </div>
          <button
            aria-label={`Delete playlist ${p.name}`}
            onClick={() => deletePlaylist(p.id)}
            className="mr-1 hidden shrink-0 rounded p-1 text-muted-foreground hover:text-danger group-hover:block"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}

      <div className="mt-auto border-t border-border pt-3">
        <NavItem
          icon={FolderOpen}
          label="History"
          active={false}
          onClick={() => setShowHistory(true)}
        />
        <NavItem
          icon={Settings}
          label="Settings"
          active={false}
          onClick={() => setShowSettings(true)}
        />
      </div>
    </nav>
  );
}
