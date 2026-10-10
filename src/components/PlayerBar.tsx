import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Repeat1,
  Shuffle,
  Volume2,
  VolumeX,
  Music,
  SlidersHorizontal,
} from "lucide-react";
import { useAppStore } from "../store";
import {
  play,
  pause,
  next,
  prev,
  seek,
  applyVolumeFromStore,
} from "../lib/player";
import { getCover } from "../lib/cover";

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlayerBar() {
  const {
    tracks,
    currentTrackId,
    isPlaying,
    position,
    volume,
    muted,
    repeat,
    shuffle,
    setIsPlaying,
    setVolume,
    setMuted,
    setRepeat,
    setShuffle,
    setPosition,
    setShowEqualizer,
    showEqualizer,
  } = useAppStore();

  const track = tracks.find((t) => t.id === currentTrackId) ?? null;
  const [cover, setCover] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!track) {
      setCover(null);
      return;
    }
    getCover(track).then((url) => {
      if (!cancelled) setCover(url);
    });
    return () => {
      cancelled = true;
    };
  }, [track?.id]);

  const togglePlay = () => {
    if (isPlaying) {
      pause();
      setIsPlaying(false);
    } else {
      play();
    }
  };

  return (
    <footer className="glass flex h-24 shrink-0 items-center gap-6 border-t border-border px-5">
      {/* Track info */}
      <div className="flex w-72 min-w-0 items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-elevated">
          {cover ? (
            <img
              src={cover}
              alt={`${track?.album ?? "Album"} cover`}
              className="h-full w-full object-cover"
            />
          ) : (
            <Music className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {track ? track.title : "Nothing playing"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {track
              ? `${track.artist || "Unknown artist"}${track.album ? " — " + track.album : ""}`
              : "Double-click a track to begin"}
          </div>
        </div>
      </div>

      {/* Transport */}
      <div className="flex flex-1 flex-col items-center gap-1.5">
        <div className="flex items-center gap-4">
          <button
            aria-label="Shuffle"
            aria-pressed={shuffle}
            onClick={() => setShuffle(!shuffle)}
            className={`transition ${shuffle ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Shuffle className="h-4 w-4" />
          </button>
          <button
            aria-label="Previous"
            onClick={prev}
            className="text-foreground transition hover:text-accent"
          >
            <SkipBack className="h-5 w-5 fill-current" />
          </button>
          <button
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={togglePlay}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground transition hover:scale-105 hover:bg-accent-hover"
          >
            {isPlaying ? (
              <Pause className="h-5 w-5 fill-current" />
            ) : (
              <Play className="ml-0.5 h-5 w-5 fill-current" />
            )}
          </button>
          <button
            aria-label="Next"
            onClick={next}
            className="text-foreground transition hover:text-accent"
          >
            <SkipForward className="h-5 w-5 fill-current" />
          </button>
          <button
            aria-label={`Repeat: ${repeat}`}
            aria-pressed={repeat !== "off"}
            onClick={() =>
              setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")
            }
            className={`transition ${repeat !== "off" ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
          >
            {repeat === "one" ? (
              <Repeat1 className="h-4 w-4" />
            ) : (
              <Repeat className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="flex w-full max-w-xl items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          <span>{formatTime(position)}</span>
          <input
            type="range"
            min={0}
            max={track?.durationSeconds ?? 0}
            step={0.1}
            value={Math.min(position, track?.durationSeconds ?? 0)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              seek(v);
              setPosition(v);
            }}
            disabled={!track}
            aria-label="Seek"
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-accent disabled:opacity-40"
          />
          <span>{formatTime(track?.durationSeconds ?? 0)}</span>
        </div>
      </div>

      {/* Volume + EQ */}
      <div className="flex w-56 items-center justify-end gap-3">
        <button
          aria-label="Equalizer"
          aria-pressed={showEqualizer}
          onClick={() => setShowEqualizer(!showEqualizer)}
          className={`transition ${showEqualizer ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <button
          aria-label={muted ? "Unmute" : "Mute"}
          onClick={() => {
            setMuted(!muted);
            setTimeout(applyVolumeFromStore, 0);
          }}
          className="text-muted-foreground transition hover:text-foreground"
        >
          {muted || volume === 0 ? (
            <VolumeX className="h-5 w-5" />
          ) : (
            <Volume2 className="h-5 w-5" />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => {
            setVolume(parseFloat(e.target.value));
            if (muted) setMuted(false);
            applyVolumeFromStore();
          }}
          aria-label="Volume"
          className="h-1 w-28 cursor-pointer appearance-none rounded-full bg-border accent-accent"
        />
      </div>
    </footer>
  );
}
