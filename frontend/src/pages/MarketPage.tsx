import { useEffect, useState } from "react";
import { fetchMarket } from "../api";
import type { MarketData } from "../types";

const WINDOWS = ["24h", "3d", "7d", "30d"] as const;
type Window = typeof WINDOWS[number];

const WINDOW_LABELS: Record<Window, string> = {
  "24h": "Last 24 hours",
  "3d":  "Last 3 days",
  "7d":  "Last 7 days",
  "30d": "Last 30 days",
};

const SOURCE_LABELS: Record<string, string> = {
  usajobs: "USAJobs",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  "80k_hours": "80k Hours",
  climatebase: "Climatebase",
  manual: "Manual",
};

export default function MarketPage({ onBack }: { onBack?: () => void }) {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeWindow, setActiveWindow] = useState<Window>("24h");

  useEffect(() => {
    fetchMarket()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Loading market data…</div>
  );
  if (error) return (
    <div style={{ padding: 40, color: "#dc2626" }}>Error: {error}</div>
  );
  if (!data) return null;

  const window = data.activity[activeWindow];
  const maxStateCount = Math.max(...(window.by_state.map(s => s.count)), 1);
  const maxTrendDelta = Math.max(...data.trending.filter(t => t.delta > 0).map(t => t.delta), 1);
  const maxSalary = Math.max(...data.salary.by_state.map(s => s.avg_min), 1);
  const maxIndustry = Math.max(...(data.industry?.map(i => i.total) ?? []), 1);

  const totalScored = data.summary.score_distribution.excellent +
    data.summary.score_distribution.good + data.summary.score_distribution.low;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px 80px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <button onClick={onBack} style={backBtn}>← Back to Jobs</button>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: 20, color: "#1e293b" }}>Job Market Intelligence</h2>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {data.summary.total_jobs.toLocaleString()} total jobs · {data.summary.remote_pct}% remote
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {WINDOWS.map(w => (
          <div
            key={w}
            onClick={() => setActiveWindow(w)}
            style={{
              ...card,
              cursor: "pointer",
              border: activeWindow === w ? "2px solid #2563eb" : "1px solid #e2e8f0",
              background: activeWindow === w ? "#eff6ff" : "#fff",
            }}
          >
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {WINDOW_LABELS[w]}
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: activeWindow === w ? "#2563eb" : "#1e293b", marginTop: 4 }}>
              {data.activity[w].total.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>new postings</div>
          </div>
        ))}
        <div style={card}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Avg Salary</div>
          {data.salary.overall_avg_min ? (
            <>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#16a34a", marginTop: 4 }}>
                ${Math.round(data.salary.overall_avg_min / 1000)}k
                {data.salary.overall_avg_max ? `–${Math.round(data.salary.overall_avg_max / 1000)}k` : ""}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>annual avg range</div>
            </>
          ) : <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 8 }}>No data yet</div>}
        </div>
        <div style={card}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>AI Scored</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#7c3aed", marginTop: 4 }}>
            {totalScored.toLocaleString()}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#16a34a", fontWeight: 600 }}>✦ {data.summary.score_distribution.excellent} great</span>
            <span style={{ fontSize: 10, color: "#d97706", fontWeight: 600 }}>✦ {data.summary.score_distribution.good} good</span>
            <span style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>✦ {data.summary.score_distribution.low} low</span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* Activity by state for selected window */}
        <div style={card}>
          <div style={sectionTitle}>Top Locations — {WINDOW_LABELS[activeWindow]}</div>
          {window.by_state.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13, paddingTop: 8 }}>No location data for this window</div>
          ) : window.by_state.map(({ state, count }) => (
            <div key={state} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                <span style={{ fontWeight: 600, color: "#334155" }}>{state}</span>
                <span style={{ color: "#64748b" }}>{count}</span>
              </div>
              <div style={{ background: "#f1f5f9", borderRadius: 4, height: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "#2563eb", borderRadius: 4, width: `${(count / maxStateCount) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        {/* Source breakdown */}
        <div style={card}>
          <div style={sectionTitle}>By Source — {WINDOW_LABELS[activeWindow]}</div>
          {Object.entries(window.by_source).length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13, paddingTop: 8 }}>No data</div>
          ) : Object.entries(window.by_source)
            .sort((a, b) => b[1] - a[1])
            .map(([src, count]) => {
              const maxSrc = Math.max(...Object.values(window.by_source));
              return (
                <div key={src} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, color: "#334155" }}>{SOURCE_LABELS[src] ?? src}</span>
                    <span style={{ color: "#64748b" }}>{count}</span>
                  </div>
                  <div style={{ background: "#f1f5f9", borderRadius: 4, height: 6, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "#7c3aed", borderRadius: 4, width: `${(count / maxSrc) * 100}%` }} />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* Trending locations (24h vs prior 24h) */}
        <div style={card}>
          <div style={sectionTitle}>Trending Locations <span style={{ fontWeight: 400, color: "#94a3b8", fontSize: 11 }}>24h vs prior 24h</span></div>
          {data.trending.filter(t => t.current_24h > 0 || t.prev_24h > 0).slice(0, 12).map(t => (
            <div key={t.state} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 12 }}>
              <span style={{ width: 32, textAlign: "right", fontWeight: 700, color: t.delta > 0 ? "#16a34a" : t.delta < 0 ? "#dc2626" : "#94a3b8" }}>
                {t.delta > 0 ? "+" : ""}{t.delta}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, color: "#334155" }}>{t.state}</span>
                  <span style={{ color: "#94a3b8", fontSize: 11 }}>{t.current_24h} now / {t.prev_24h} prev</span>
                </div>
                <div style={{ background: "#f1f5f9", borderRadius: 4, height: 4, marginTop: 2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 4,
                    background: t.delta > 0 ? "#16a34a" : t.delta < 0 ? "#dc2626" : "#94a3b8",
                    width: `${Math.min(100, (Math.abs(t.delta) / maxTrendDelta) * 100)}%`,
                  }} />
                </div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, minWidth: 40, textAlign: "right",
                color: t.pct_change > 0 ? "#16a34a" : t.pct_change < 0 ? "#dc2626" : "#94a3b8",
              }}>
                {t.pct_change > 0 ? "+" : ""}{t.pct_change}%
              </span>
            </div>
          ))}
          {data.trending.filter(t => t.current_24h > 0 || t.prev_24h > 0).length === 0 && (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>Not enough recent data to show trends</div>
          )}
        </div>

        {/* Salary by state */}
        <div style={card}>
          <div style={sectionTitle}>Avg Salary by State</div>
          {data.salary.by_state.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13, paddingTop: 8 }}>No salary data available</div>
          ) : data.salary.by_state.slice(0, 12).map(s => (
            <div key={s.state} style={{ marginBottom: 7 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                <span style={{ fontWeight: 600, color: "#334155" }}>{s.state ?? "Unknown"}</span>
                <span style={{ color: "#16a34a", fontWeight: 600 }}>
                  ${Math.round(s.avg_min / 1000)}k{s.avg_max ? `–${Math.round(s.avg_max / 1000)}k` : ""}
                  <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 10, marginLeft: 4 }}>({s.count})</span>
                </span>
              </div>
              <div style={{ background: "#f1f5f9", borderRadius: 4, height: 5, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "#16a34a", borderRadius: 4, width: `${(s.avg_min / maxSalary) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Industry breakdown — full width */}
      {data.industry && data.industry.length > 0 && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={sectionTitle}>Industry / Sector Breakdown</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "6px 24px" }}>
            {data.industry.map(ind => (
              <div key={ind.industry}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, color: "#334155" }}>{ind.industry}</span>
                  <span style={{ color: "#64748b", display: "flex", gap: 10 }}>
                    <span style={{ color: "#2563eb", fontWeight: 600 }}>{ind.total.toLocaleString()}</span>
                    {ind.last_24h > 0 && (
                      <span style={{ color: "#16a34a", fontSize: 11 }}>+{ind.last_24h} 24h</span>
                    )}
                    {ind.last_7d > 0 && (
                      <span style={{ color: "#7c3aed", fontSize: 11 }}>+{ind.last_7d} 7d</span>
                    )}
                  </span>
                </div>
                <div style={{ background: "#f1f5f9", borderRadius: 4, height: 5, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 4,
                    background: "linear-gradient(90deg, #2563eb, #7c3aed)",
                    width: `${(ind.total / maxIndustry) * 100}%`,
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>

        {/* Salary by source */}
        <div style={card}>
          <div style={sectionTitle}>Avg Salary by Source</div>
          {data.salary.by_source.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>No salary data</div>
          ) : data.salary.by_source.map(s => (
            <div key={s.source} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: "#334155", fontWeight: 600 }}>{SOURCE_LABELS[s.source] ?? s.source}</span>
              <span style={{ color: "#16a34a", fontWeight: 600 }}>
                ${Math.round(s.avg_min / 1000)}k{s.avg_max ? `–${Math.round(s.avg_max / 1000)}k` : ""}
              </span>
            </div>
          ))}
        </div>

        {/* Top companies */}
        <div style={card}>
          <div style={sectionTitle}>Top Hiring Organizations</div>
          {data.summary.top_companies.map((c, i) => (
            <div key={c.company} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 5 }}>
              <span style={{ color: "#334155" }}>
                <span style={{ color: "#94a3b8", marginRight: 6, fontSize: 11 }}>{i + 1}.</span>
                {c.company}
              </span>
              <span style={{ fontWeight: 700, color: "#2563eb", fontSize: 12 }}>{c.count}</span>
            </div>
          ))}
        </div>

        {/* Score distribution + job types */}
        <div style={card}>
          <div style={sectionTitle}>AI Fit Distribution</div>
          {totalScored === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>Score jobs to see distribution</div>
          ) : (
            <>
              {[
                { label: "Excellent (4.0+)", count: data.summary.score_distribution.excellent, color: "#16a34a" },
                { label: "Good (3.0–3.9)", count: data.summary.score_distribution.good, color: "#d97706" },
                { label: "Low (<3.0)", count: data.summary.score_distribution.low, color: "#dc2626" },
                { label: "Unscored", count: data.summary.score_distribution.unscored, color: "#cbd5e1" },
              ].map(row => (
                <div key={row.label} style={{ marginBottom: 7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                    <span style={{ color: "#334155" }}>{row.label}</span>
                    <span style={{ fontWeight: 700, color: row.color }}>{row.count.toLocaleString()}</span>
                  </div>
                  <div style={{ background: "#f1f5f9", borderRadius: 4, height: 5, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4, background: row.color,
                      width: `${(row.count / data.summary.total_jobs) * 100}%`,
                    }} />
                  </div>
                </div>
              ))}
            </>
          )}
          <div style={{ ...sectionTitle, marginTop: 14 }}>Job Types</div>
          {Object.entries(data.summary.by_job_type)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([type, count]) => (
              <div key={type} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "#334155", textTransform: "capitalize" }}>{type.replace("_", " ")}</span>
                <span style={{ color: "#64748b" }}>{count.toLocaleString()}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "16px 18px",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#64748b",
  marginBottom: 12,
};

const backBtn: React.CSSProperties = {
  padding: "6px 14px",
  background: "#f1f5f9",
  color: "#334155",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
