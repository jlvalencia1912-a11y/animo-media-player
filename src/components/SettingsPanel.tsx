import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderPlus,
  RefreshCw,
  Trash2,
  AlertTriangle,
  MonitorSpeaker,
  Mic,
} from "lucide-react";
import { useAppStore } from "../store";
import { Modal } from "./Modal";
import { scanLibrary } from "../lib/library";
import { setOutputDevice, setMicMonitoring, getAudioElement } from "../lib/player";

export function SettingsPanel() {
  const {
    showSettings,
    setShowSettings,
    monitoredFolders,
    setMonitoredFolders,
    removeTracksUnder,
    scanning,
    settings,
    updateSettings,
    tracks,
  } = useAppStore();

  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [deviceNote, setDeviceNote] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);

  const refreshDevices = async () => {
    try {
      // Request mic permission once so labels are available
      const stream = await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .catch(() => null);
      stream?.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      setOutputs(devices.filter((d) => d.kind === "audiooutput"));
      setInputs(devices.filter((d) => d.kind === "audioinput"));
      setDeviceNote(null);
    } catch {
      setDeviceNote("Could not enumerate audio devices on this system.");
    }
  };

  useEffect(() => {
    if (showSettings) refreshDevices();
  }, [showSettings]);

  const addFolder = async () => {
    setFolderError(null);
    const picked = await open({ directory: true, multiple: false });
    if (!picked || typeof picked !== "string") return;
    const exists = await invoke<boolean>("file_exists", {
      path: picked + "/__animo_probe__",
    }).catch(() => true);
    void exists; // existence check is a placeholder — directory check happens in scan
    if (monitoredFolders.some((f) => f.path.toLowerCase() === picked.toLowerCase())) {
      setFolderError("That folder is already monitored.");
      return;
    }
    setMonitoredFolders([...monitoredFolders, { path: picked, addedAt: Date.now() }]);
    scanLibrary([...monitoredFolders.map((f) => f.path), picked]);
  };

  const removeFolder = (path: string) => {
    setMonitoredFolders(monitoredFolders.filter((f) => f.path !== path));
    removeTracksUnder(path);
  };

  const rescanAll = () => {
    if (monitoredFolders.length) {
      scanLibrary(monitoredFolders.map((f) => f.path));
    }
  };

  return (
    <Modal open={showSettings} title="Settings" onClose={() => setShowSettings(false)} wide>
      <div className="flex flex-col gap-6">
        {/* Monitored folders */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Music folders</h3>
            <div className="flex gap-2">
              <button
                onClick={rescanAll}
                disabled={scanning || monitoredFolders.length === 0}
                className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
                Rescan all
              </button>
              <button
                onClick={addFolder}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground transition hover:bg-accent-hover"
              >
                <FolderPlus className="h-3.5 w-3.5" /> Add folder
              </button>
            </div>
          </div>
          {folderError && (
            <p className="mb-2 text-xs text-warning">{folderError}</p>
          )}
          {monitoredFolders.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No folders monitored. Add your music folder (e.g.{" "}
              <code className="text-foreground/80">C:\Users\you\Music</code>) to
              build the library.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {monitoredFolders.map((f) => (
                <li
                  key={f.path}
                  className="flex items-center justify-between rounded-lg bg-surface-elevated px-3 py-2 text-sm"
                >
                  <span className="truncate text-foreground/90" title={f.path}>
                    {f.path}
                  </span>
                  <button
                    onClick={() => removeFolder(f.path)}
                    aria-label={`Remove ${f.path}`}
                    className="ml-3 shrink-0 rounded p-1 text-muted-foreground transition hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Tray behavior */}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Window & tray</h3>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-surface-elevated px-3 py-2.5">
            <input
              type="checkbox"
              checked={settings.closeToTray}
              onChange={(e) => updateSettings({ closeToTray: e.target.checked })}
              className="h-4 w-4 accent-accent"
            />
            <div className="text-sm">
              <div className="text-foreground">Keep running in the system tray</div>
              <div className="text-xs text-muted-foreground">
                Closing the window hides the app instead of quitting. Uncheck to
                quit on close.
              </div>
            </div>
          </label>
        </section>

        {/* Audio output */}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <MonitorSpeaker className="h-4 w-4 text-accent" /> Audio output
          </h3>
          <select
            value={settings.outputDeviceId}
            onChange={(e) => {
              updateSettings({ outputDeviceId: e.target.value });
              setOutputDevice(e.target.value);
            }}
            aria-label="Output device"
            className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
          >
            <option value="default" className="bg-surface-elevated">
              System default
            </option>
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId} className="bg-surface-elevated">
                {d.label || `Device ${d.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
          {deviceNote && <p className="mt-1.5 text-xs text-warning">{deviceNote}</p>}
          <div className="mt-2 rounded-lg border border-border/60 bg-surface-elevated/50 p-3 text-xs text-muted-foreground">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground/80">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" /> Advanced output
              modes
            </div>
            WASAPI exclusive mode and ASIO are not available in this release —
            the WebView2 audio engine always uses Windows shared mode. Exclusive
            output may be evaluated later with a native audio backend; playback
            automatically falls back to shared mode.
          </div>
        </section>

        {/* Microphone input */}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Mic className="h-4 w-4 text-accent" /> Microphone input (monitoring)
          </h3>
          <label className="mb-2 flex cursor-pointer items-center gap-3 rounded-lg bg-surface-elevated px-3 py-2.5">
            <input
              type="checkbox"
              checked={settings.micMonitoring}
              onChange={(e) => {
                updateSettings({ micMonitoring: e.target.checked });
                setMicMonitoring(e.target.checked, settings.micDeviceId);
              }}
              className="h-4 w-4 accent-accent"
            />
            <div className="text-sm">
              <div className="text-foreground">Monitor microphone through output</div>
              <div className="text-xs text-muted-foreground">
                Monitoring only — the mic is heard through your speakers. It is not
                recorded. Lower volume if you hear feedback.
              </div>
            </div>
          </label>
          {settings.micMonitoring && (
            <select
              value={settings.micDeviceId}
              onChange={(e) => {
                updateSettings({ micDeviceId: e.target.value });
                setMicMonitoring(true, e.target.value);
              }}
              aria-label="Input device"
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
            >
              <option value="default" className="bg-surface-elevated">
                System default input
              </option>
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId} className="bg-surface-elevated">
                  {d.label || `Input ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          )}
        </section>

        <p className="text-xs text-muted-foreground/70">
          {tracks.length} tracks in library · playback works fully offline
        </p>
      </div>
      <AudioRefresher />
    </Modal>
  );
}

/** Ensures the audio graph exists so device changes apply immediately. */
function AudioRefresher() {
  useEffect(() => {
    void getAudioElement();
  }, []);
  return null;
}
