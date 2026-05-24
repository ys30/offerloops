import { useRef, useState } from "react";

const PROVIDERS = [
  { id: "anthropic", label: "Claude Opus 4.7" },
  { id: "nvidia",    label: "NVIDIA NIM (Llama 3.3 70B)" },
  { id: "openai",    label: "GPT-4o" },
  { id: "gemini",    label: "Gemini 1.5 Pro" },
];

interface LogEntry {
  job_id: string;
  title: string;
  score?: number;
  error?: string;
}

interface Props {
  onDone: () => void;
  onClose: () => void;
}

export default function ScoreAllPanel({ onDone, onClose }: Props) {
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [rescore, setRescore] = useState(false);
  const [recentOnly, setRecentOnly] = useState(true);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [total, setTotal] = useState(0);
  const [scored, setScored] = useState(0);
  const [failed, setFailed] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [startError, setStartError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  async function start() {
    setRunning(true);
    setDone(false);
    setStartError("");
    setLog([]);
    setTotal(0);
    setScored(0);
    setFailed(0);

    const qs = new URLSearchParams({ provider, rescore: String(rescore) });
    if (recentOnly) qs.set("days", "7");
    if (apiKey) qs.set("api_key", apiKey);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let response: Response;
    try {
      response = await fetch(`/api/ai/score-all?${qs}`, {
        method: "POST",
        signal: ctrl.signal,
      });
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") { setRunning(false); return; }
      setStartError(e instanceof Error ? e.message : String(e));
      setRunning(false);
      return;
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { const body = await response.json(); detail = body.detail || detail; } catch { /* */ }
      setStartError(detail);
      setRunning(false);
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          const type = evt.type as string;
          if (type === "start") {
            setTotal(evt.total as number);
          } else if (type === "progress") {
            setScored(evt.scored as number);
            setFailed(evt.failed as number);
            setLog(prev => [
              { job_id: evt.job_id as string, title: evt.title as string, score: evt.score as number },
              ...prev.slice(0, 19),
            ]);
          } else if (type === "error") {
            setScored(evt.scored as number);
            setFailed(evt.failed as number);
            setLog(prev => [
              { job_id: evt.job_id as string, title: evt.title as string, error: evt.error as string },
              ...prev.slice(0, 19),
            ]);
          } else if (type === "done") {
            setScored(evt.scored as number);
            setFailed(evt.failed as number);
            setDone(true);
            onDone();
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") {
        setStartError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setRunning(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const pct = total > 0 ? Math.round(((scored + failed) / total) * 100) : 0;

  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Score All Jobs vs. Profile Resume</span>
        {!running && (
          <button onClick={onClose} style={closeBtn}>✕</button>
        )}
      </div>

      {/* Provider selector */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            onClick={() => !running && setProvider(p.id)}
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600,
              border: "1px solid #e2e8f0", borderRadius: 5, cursor: running ? "default" : "pointer",
              background: provider === p.id ? "#2563eb" : "#fff",
              color: provider === p.id ? "#fff" : "#374151",
              opacity: running ? 0.7 : 1,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* API key + rescore options */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          disabled={running}
          placeholder="API key (optional if set server-side)"
          style={inp}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#64748b", cursor: "pointer", whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={recentOnly}
            onChange={e => setRecentOnly(e.target.checked)}
            disabled={running}
          />
          Posted in last 7 days only
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#64748b", cursor: "pointer", whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={rescore}
            onChange={e => setRescore(e.target.checked)}
            disabled={running}
          />
          Re-score already-scored jobs
        </label>
      </div>

      {startError && (
        <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 8, padding: "6px 10px", background: "#fef2f2", borderRadius: 5 }}>
          {startError}
        </div>
      )}

      {/* Action buttons */}
      {!running && !done && (
        <button onClick={start} style={primaryBtn}>
          ▶ Start Scoring
        </button>
      )}
      {running && (
        <button onClick={cancel} style={{ ...primaryBtn, background: "#dc2626" }}>
          ✕ Cancel
        </button>
      )}
      {done && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#166534" }}>
            Done — {scored} scored{failed > 0 ? `, ${failed} failed` : ""}
          </span>
          <button onClick={() => { setDone(false); setLog([]); }} style={secondaryBtn}>Score again</button>
          <button onClick={onClose} style={secondaryBtn}>Close</button>
        </div>
      )}

      {/* Progress */}
      {(running || done) && total > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
            <span>{scored + failed} / {total} processed</span>
            <span>{failed > 0 ? <span style={{ color: "#dc2626" }}>{failed} failed</span> : null} {pct}%</span>
          </div>
          <div style={{ background: "#e2e8f0", borderRadius: 999, height: 7, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 999, transition: "width 0.3s",
              width: `${pct}%`,
              background: failed > 0 ? "linear-gradient(90deg,#2563eb,#dc2626)" : "#2563eb",
            }} />
          </div>
        </div>
      )}

      {/* Log */}
      {log.length > 0 && (
        <div style={{ marginTop: 12, maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
          {log.map(entry => (
            <div key={entry.job_id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontSize: 11, padding: "4px 8px", borderRadius: 5,
              background: entry.error ? "#fef2f2" : "#f0fdf4",
            }}>
              <span style={{ color: entry.error ? "#dc2626" : "#166534", marginRight: 8 }}>
                {entry.error ? "✗" : "✓"}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1e293b" }}>
                {entry.title}
              </span>
              {entry.score != null && (
                <span style={{ marginLeft: 8, fontWeight: 700, color: entry.score >= 4 ? "#166534" : entry.score >= 3 ? "#92400e" : "#9b1c1c" }}>
                  {entry.score.toFixed(1)}/5
                </span>
              )}
              {entry.error && (
                <span style={{ marginLeft: 8, color: "#dc2626", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entry.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "16px 18px",
  marginBottom: 16,
};

const inp: React.CSSProperties = {
  flex: 1,
  minWidth: 180,
  padding: "7px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 12,
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 18px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const secondaryBtn: React.CSSProperties = {
  ...primaryBtn,
  background: "#f1f5f9",
  color: "#334155",
  border: "1px solid #e2e8f0",
};

const closeBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#94a3b8",
  fontSize: 16,
  padding: "0 4px",
  lineHeight: 1,
};
