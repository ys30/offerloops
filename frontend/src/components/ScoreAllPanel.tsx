import { useRef, useState } from "react";
import { getToken } from "../api";
import IndustryMultiSelect from "./IndustryMultiSelect";

const PROVIDERS = [
  { id: "nvidia",    label: "NVIDIA NIM · Auto", auto: true },
  { id: "anthropic", label: "Claude Opus 4.7",   auto: false },
  { id: "openai",    label: "GPT-4o",             auto: false },
  { id: "gemini",    label: "Gemini 1.5 Pro",     auto: false },
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California",
  CO:"Colorado", CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia",
  HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa",
  KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland",
  MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri",
  MT:"Montana", NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey",
  NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio",
  OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina",
  SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont",
  VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming", DC:"D.C.",
};

const TIME_OPTIONS = [
  { value: "",   label: "All time" },
  { value: "3",  label: "Last 3 days" },
  { value: "7",  label: "Last 7 days" },
  { value: "15", label: "Last 15 days" },
  { value: "30", label: "Last 30 days" },
];

const SOURCES = [
  { value: "",            label: "All sources" },
  { value: "usajobs",     label: "USAJobs" },
  { value: "greenhouse",  label: "Greenhouse" },
  { value: "lever",       label: "Lever" },
  { value: "ashby",       label: "Ashby" },
  { value: "80k_hours",   label: "80,000 Hours" },
  { value: "climatebase", label: "Climatebase" },
  { value: "manual",      label: "Manual" },
];

interface LogEntry {
  job_id: string;
  title: string;
  score?: number;
  error?: string;
}

interface Props {
  user?: { id: string } | null;
  onSignIn?: () => void;
  onDone: () => void;
  onClose: () => void;
}

export default function ScoreAllPanel({ user, onSignIn, onDone, onClose }: Props) {
  const [provider, setProvider] = useState("nvidia");
  const [apiKey, setApiKey] = useState("");
  const [rescore, setRescore] = useState(false);
  const [days, setDays] = useState("7");
  const [sourceFilter, setSourceFilter] = useState("");
  const [remoteFilter, setRemoteFilter] = useState<"" | "true" | "false">("");

  // Area selection: "us" = all US, "states" = specific states
  const [areaMode, setAreaMode] = useState<"us" | "states" | "all">("us");
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [stateDropOpen, setStateDropOpen] = useState(false);

  const [selectedIndustries, setSelectedIndustries] = useState<Set<string>>(new Set());

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [total, setTotal] = useState(0);
  const [scored, setScored] = useState(0);
  const [failed, setFailed] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [startError, setStartError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  function toggleState(code: string) {
    setSelectedStates(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  function selectAllStates() { setSelectedStates(new Set(US_STATES)); }
  function clearStates() { setSelectedStates(new Set()); }

  function areaLabel() {
    if (areaMode === "all") return "All locations";
    if (areaMode === "us") return "🇺🇸 United States (all)";
    if (selectedStates.size === 0) return "Select states…";
    if (selectedStates.size <= 4) return Array.from(selectedStates).join(", ");
    return `${Array.from(selectedStates).slice(0, 3).join(", ")} +${selectedStates.size - 3} more`;
  }

  async function start() {
    setRunning(true);
    setDone(false);
    setStartError("");
    setLog([]);
    setTotal(0);
    setScored(0);
    setFailed(0);

    const qs = new URLSearchParams({ provider, rescore: String(rescore) });
    if (days) qs.set("days", days);
    if (sourceFilter) qs.set("source", sourceFilter);
    if (remoteFilter !== "") qs.set("remote", remoteFilter);
    if (selectedIndustries.size > 0) qs.set("industries", Array.from(selectedIndustries).join(","));
    if (apiKey) qs.set("api_key", apiKey);

    if (areaMode === "states" && selectedStates.size > 0) {
      qs.set("states", Array.from(selectedStates).join(","));
    } else if (areaMode === "us") {
      qs.set("us_only", "true");
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let response: Response;
    try {
      const token = getToken();
      response = await fetch(`/api/ai/score-all?${qs}`, {
        method: "POST",
        signal: ctrl.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") { setRunning(false); return; }
      setStartError(e instanceof Error ? e.message : String(e));
      setRunning(false);
      return;
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { const body = await response.json(); detail = body.detail || detail; } catch { /**/ }
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

  if (!user) {
    return (
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Score All Jobs vs. Profile Resume</span>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>
        <div style={{ padding: "16px 0", textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
            Sign in to score all jobs against your resume.
          </div>
          <button onClick={onSignIn} style={{ ...primaryBtn, display: "inline-block" }}>
            Sign in / Create account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={panel}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>⚡ Score All Jobs vs. Profile Resume</span>
        {!running && <button onClick={onClose} style={closeBtn}>✕</button>}
      </div>

      {/* Provider selector */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
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
          >{p.label}</button>
        ))}
      </div>

      {/* Filter grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr auto", gap: 8, marginBottom: 10, alignItems: "start" }}>

        {/* Area dropdown */}
        <div>
          <div style={filterLabel}>Area</div>
          <div style={{ position: "relative" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {/* Mode selector */}
              <select
                value={areaMode}
                disabled={running}
                onChange={e => { setAreaMode(e.target.value as "us" | "states" | "all"); setStateDropOpen(false); }}
                style={sel}
              >
                <option value="all">All locations</option>
                <option value="us">🇺🇸 United States (all)</option>
                <option value="states">Specific states…</option>
              </select>

              {/* State multi-select — only shown when mode = states */}
              {areaMode === "states" && (
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    disabled={running}
                    onClick={() => setStateDropOpen(v => !v)}
                    style={{
                      ...sel, width: "100%", textAlign: "left", cursor: running ? "default" : "pointer",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      color: selectedStates.size === 0 ? "#94a3b8" : "#1e293b",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {areaLabel()}
                    </span>
                    <span style={{ marginLeft: 4, fontSize: 10, color: "#94a3b8" }}>{stateDropOpen ? "▲" : "▼"}</span>
                  </button>

                  {stateDropOpen && (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, zIndex: 200,
                      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                      width: 280, maxHeight: 320, overflowY: "auto", padding: 8,
                    }}>
                      {/* Quick actions */}
                      <div style={{ display: "flex", gap: 6, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #f1f5f9" }}>
                        <button onClick={selectAllStates} style={tinyBtn}>Select all</button>
                        <button onClick={clearStates} style={tinyBtn}>Clear</button>
                        <span style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center", marginLeft: "auto" }}>
                          {selectedStates.size} selected
                        </span>
                      </div>
                      {/* State grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                        {US_STATES.map(code => (
                          <label key={code} style={{
                            display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                            borderRadius: 5, cursor: "pointer", fontSize: 12,
                            background: selectedStates.has(code) ? "#eff6ff" : "transparent",
                            color: selectedStates.has(code) ? "#2563eb" : "#334155",
                            fontWeight: selectedStates.has(code) ? 600 : 400,
                          }}>
                            <input
                              type="checkbox"
                              checked={selectedStates.has(code)}
                              onChange={() => toggleState(code)}
                              style={{ accentColor: "#2563eb" }}
                            />
                            <span style={{ fontWeight: 700, minWidth: 24 }}>{code}</span>
                            <span style={{ fontSize: 10, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {STATE_NAMES[code]}
                            </span>
                          </label>
                        ))}
                      </div>
                      <div style={{ paddingTop: 8, borderTop: "1px solid #f1f5f9", marginTop: 8, textAlign: "right" }}>
                        <button onClick={() => setStateDropOpen(false)} style={{ ...tinyBtn, background: "#2563eb", color: "#fff", border: "none" }}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Time range */}
        <div>
          <div style={filterLabel}>Time range</div>
          <select value={days} onChange={e => setDays(e.target.value)} disabled={running} style={sel}>
            {TIME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Source */}
        <div>
          <div style={filterLabel}>Source</div>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} disabled={running} style={sel}>
            {SOURCES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Industry */}
        <div>
          <div style={filterLabel}>Industry</div>
          <IndustryMultiSelect
            selected={selectedIndustries}
            onChange={setSelectedIndustries}
            disabled={running}
          />
        </div>

        {/* Remote */}
        <div>
          <div style={filterLabel}>Location type</div>
          <select value={remoteFilter} onChange={e => setRemoteFilter(e.target.value as "" | "true" | "false")} disabled={running} style={sel}>
            <option value="">Any (remote + on-site)</option>
            <option value="true">Remote only</option>
            <option value="false">On-site only</option>
          </select>
        </div>

        {/* Re-score toggle */}
        <div style={{ paddingTop: 20 }}>
          <label style={checkLabel}>
            <input type="checkbox" checked={rescore} onChange={e => setRescore(e.target.checked)} disabled={running} />
            Re-score existing
          </label>
        </div>
      </div>

      {/* API key */}
      {PROVIDERS.find(p => p.id === provider)?.auto ? (
        <div style={{ marginBottom: 10, fontSize: 12, color: "#16a34a", padding: "6px 10px", background: "#f0fdf4", borderRadius: 5, border: "1px solid #bbf7d0" }}>
          ✓ Built-in key — no API key needed
        </div>
      ) : (
        <div style={{ marginBottom: 10 }}>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            disabled={running}
            placeholder="Your API key"
            style={{ ...inp, width: "100%" }}
          />
        </div>
      )}

      {startError && (
        <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 8, padding: "6px 10px", background: "#fef2f2", borderRadius: 5 }}>
          {startError}
        </div>
      )}

      {/* Action buttons */}
      {!running && !done && (
        <button onClick={start} style={primaryBtn}>▶ Start Scoring</button>
      )}
      {running && (
        <button onClick={cancel} style={{ ...primaryBtn, background: "#dc2626" }}>✕ Cancel</button>
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

      {/* Progress bar */}
      {(running || done) && total > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
            <span>{scored + failed} / {total} processed</span>
            <span>{failed > 0 && <span style={{ color: "#dc2626" }}>{failed} failed &nbsp;</span>}{pct}%</span>
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

      {/* Live log */}
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

const sel: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 12,
  background: "#fff",
  cursor: "pointer",
};

const inp: React.CSSProperties = {
  padding: "7px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 12,
};

const filterLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#64748b",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const checkLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  fontSize: 12,
  color: "#64748b",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const tinyBtn: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  fontWeight: 600,
  border: "1px solid #e2e8f0",
  borderRadius: 4,
  cursor: "pointer",
  background: "#f8fafc",
  color: "#334155",
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
