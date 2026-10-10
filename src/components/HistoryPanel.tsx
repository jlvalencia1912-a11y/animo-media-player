import { History, Trash2 } from "lucide-react";
import { useAppStore } from "../store";
import { Modal } from "./Modal";

function formatWhen(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today, ${time}` : `${d.toLocaleDateString()} ${time}`;
}

export function HistoryPanel() {
  const { showHistory, setShowHistory, history, setHistory } = useAppStore();

  return (
    <Modal open={showHistory} title="Play history" onClose={() => setShowHistory(false)} wide>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {history.length} entr{history.length === 1 ? "y" : "ies"} · latest first
          </p>
          {history.length > 0 && (
            <button
              onClick={() => setHistory([])}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-danger hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear history
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
            <History className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing played yet. Your listening history will appear here.
            </p>
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto rounded-lg border border-border">
            {history.map((h, i) => (
              <li
                key={`${h.trackId}-${h.playedAt}-${i}`}
                className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2.5 text-sm last:border-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{h.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {h.artist || "Unknown artist"}
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatWhen(h.playedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
