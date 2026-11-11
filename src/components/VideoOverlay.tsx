import { useEffect, useRef } from "react";
import { X, ExternalLink } from "lucide-react";
import { useAppStore } from "../store";
import { registerVideoElement, pause } from "../lib/player";
import { openVideoWindow, sendVideoCmd } from "../lib/videoWindow";
import { isVideoPath } from "../types";

/**
 * Hosts the app's single <video> element. Always mounted (hidden) so the
 * player module can route video tracks to it the moment they're played;
 * shown as a full overlay over the track area while a video is current.
 * The element keeps native `controls` for seek/volume/fullscreen.
 *
 * When the video pop-up window is open it owns playback instead — this
 * overlay stays hidden so the track list remains visible underneath.
 */
export function VideoOverlay() {
  const ref = useRef<HTMLVideoElement>(null);
  const track = useAppStore((s) =>
    s.tracks.find((t) => t.id === s.currentTrackId),
  );
  const videoPopupOpen = useAppStore((s) => s.videoPopupOpen);
  const visible = !!track && isVideoPath(track.path);

  useEffect(() => {
    registerVideoElement(ref.current);
    return () => registerVideoElement(null);
  }, []);

  const close = () => {
    pause();
    useAppStore.getState().setCurrentTrack(null);
  };

  return (
    <div
      className={
        visible && !videoPopupOpen
          ? "absolute inset-0 z-20 flex flex-col bg-black"
          : "hidden"
      }
    >
      <video
        ref={ref}
        data-amp-video
        controls
        playsInline
        className="min-h-0 w-full flex-1 object-contain"
      />
      {visible && !videoPopupOpen && (
        <div className="absolute right-3 top-14 flex flex-col items-center gap-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            defaultValue={useAppStore.getState().volume}
            title="Volume"
            aria-label="Video volume"
            className="h-20 w-1.5 accent-[#a879f5] [writing-mode:vertical-lr]"
            onChange={(e) => {
              const v = parseFloat(e.currentTarget.value);
              const vid = document.querySelector<HTMLVideoElement>("video");
              if (vid) vid.volume = v;
              useAppStore.getState().updateSettings({ volume: v });
              sendVideoCmd({ cmd: "volume", value: v });
            }}
          />
          <button
            onClick={close}
            aria-label="Close video"
            title="Close video"
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            onClick={() => openVideoWindow()}
            aria-label="Play in pop-up window"
            title="Play in pop-up window"
            className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
          >
            <ExternalLink className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
