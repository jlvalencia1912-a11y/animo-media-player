import { AlertTriangle, RotateCcw } from "lucide-react";
import { useAppStore } from "../store";
import { Modal } from "./Modal";
import { EQ_FREQUENCIES, applyEqFromStore } from "../lib/player";

const PRESETS: { name: string; bands: number[]; preamp: number }[] = [
  { name: "Flat", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
  { name: "Bass Boost", bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], preamp: -2 },
  { name: "Treble Boost", bands: [0, 0, 0, 0, 0, 0, 2, 4, 5, 6], preamp: -2 },
  { name: "Vocal", bands: [-2, -1, 0, 2, 4, 4, 2, 0, -1, -2], preamp: 0 },
  { name: "Rock", bands: [4, 3, 1, -1, -2, 0, 2, 3, 4, 4], preamp: -2 },
  { name: "Classical", bands: [0, 0, 0, 0, 0, 0, -2, -2, 0, 3], preamp: 0 },
];

function freqLabel(f: number) {
  return f >= 1000 ? `${f / 1000}k` : `${f}`;
}

export function EqualizerPanel() {
  const { showEqualizer, setShowEqualizer, settings, updateSettings } = useAppStore();

  const setBand = (i: number, v: number) => {
    const bands = [...settings.eqBands];
    bands[i] = v;
    updateSettings({ eqBands: bands });
    applyEqFromStore();
  };

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    updateSettings({ eqBands: [...p.bands], eqPreamp: p.preamp, eqEnabled: true });
    applyEqFromStore();
  };

  const reset = () => {
    updateSettings({ eqBands: Array(10).fill(0), eqPreamp: 0 });
    applyEqFromStore();
  };

  const anyBoost =
    settings.eqPreamp > 0 || settings.eqBands.some((b) => b > 0);

  return (
    <Modal
      open={showEqualizer}
      title="Equalizer"
      onClose={() => setShowEqualizer(false)}
      wide
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={settings.eqEnabled}
              onChange={(e) => {
                updateSettings({ eqEnabled: e.target.checked });
                applyEqFromStore();
              }}
              className="h-4 w-4 accent-accent"
            />
            Enabled
          </label>
          <div className="flex items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:border-accent hover:text-foreground"
              >
                {p.name}
              </button>
            ))}
            <button
              onClick={reset}
              aria-label="Reset equalizer"
              title="Reset to flat"
              className="rounded-lg border border-border p-1.5 text-muted-foreground transition hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {anyBoost && settings.eqEnabled && (
          <p className="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Boosting frequencies or the preamp can cause clipping. Lower the
            preamp if you hear distortion.
          </p>
        )}

        <div className="flex items-end gap-1">
          {/* Preamp */}
          <div className="mr-4 flex flex-col items-center gap-1">
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {settings.eqPreamp > 0 ? "+" : ""}
              {settings.eqPreamp}
            </span>
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={settings.eqPreamp}
              onChange={(e) => {
                updateSettings({ eqPreamp: Number(e.target.value) });
                applyEqFromStore();
              }}
              aria-label="Preamp dB"
              className="h-28 w-5 cursor-pointer appearance-none"
              style={{ writingMode: "vertical-lr", direction: "rtl" }}
            />
            <span className="text-[10px] text-muted-foreground">Pre</span>
          </div>
          {EQ_FREQUENCIES.map((f, i) => (
            <div key={f} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {settings.eqBands[i] > 0 ? "+" : ""}
                {settings.eqBands[i]}
              </span>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={settings.eqBands[i]}
                onChange={(e) => setBand(i, Number(e.target.value))}
                aria-label={`${freqLabel(f)} Hz`}
                className="h-28 w-full cursor-pointer appearance-none accent-accent"
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
              />
              <span className="text-[10px] text-muted-foreground">{freqLabel(f)}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/70">
          All values in dB (±12). Changes apply instantly to the current output.
        </p>
      </div>
    </Modal>
  );
}
