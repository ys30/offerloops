import { useEffect, useState } from "react";
import { fetchDashboard } from "../api";

interface Funnel { interested: number; applied: number; responded: number; interview: number; offer: number; rejected: number }
interface WeekPoint { week: string; count: number }
interface ActivityItem { date: string; status?: string; company?: string; subject?: string; job_id?: string }
interface ReplyTemplate { event_id: string; job_id?: string; company?: string; subject?: string; status?: string; template: string }
interface Salary { avg_min?: number; avg_max?: number; sample_size: number }

interface DashData {
  funnel: Funnel;
  response_rate: number;
  interview_rate: number;
  offer_rate: number;
  avg_response_days?: number;
  ghost_count: number;
  weekly_trend: WeekPoint[];
  activity_feed: ActivityItem[];
  reply_templates: ReplyTemplate[];
  salary: Salary;
}

const STATUS_META: Record<string, { label: string; color: string; emoji: string }> = {
  applied:      { label: "Applied",       color: "#2563eb", emoji: "📋" },
  phone_screen: { label: "Phone Screen",  color: "#0891b2", emoji: "📞" },
  interview:    { label: "Interview",     color: "#7c3aed", emoji: "🎤" },
  offer:        { label: "Offer",         color: "#16a34a", emoji: "🏆" },
  rejected:     { label: "Rejected",      color: "#dc2626", emoji: "❌" },
  interested:   { label: "Interested",    color: "#6366f1", emoji: "⭐" },
};

export default function DashboardPage({ onSelectJob }: { onSelectJob: (id: string) => void }) {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard()
      .then(d => setData(d as unknown as DashData))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>Loading dashboard…</div>;
  if (error) return <div style={{ textAlign: "center", padding: 60, color: "#dc2626" }}>{error}</div>;
  if (!data) return null;

  const { funnel, response_rate, interview_rate, offer_rate, avg_response_days, ghost_count,
          weekly_trend, activity_feed, reply_templates, salary } = data;

  const maxWeek = Math.max(...weekly_trend.map(w => w.count), 1);

  function copyTemplate(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px 80px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>Career Dashboard</h1>
      <p style={{ color: "#64748b", fontSize: 13, marginTop: 0, marginBottom: 24 }}>
        Your job search at a glance — funnel, analytics, and AI reply drafts.
      </p>

      {/* ── Key Metrics ──────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total Applied",     value: funnel.applied,          sub: "in tracker",              color: "#2563eb" },
          { label: "Response Rate",     value: `${response_rate}%`,     sub: "applied → contacted",     color: "#0891b2" },
          { label: "Interview Rate",    value: `${interview_rate}%`,    sub: "applied → interview",     color: "#7c3aed" },
          { label: "Offers",            value: funnel.offer,            sub: `${offer_rate}% offer rate`,color: "#16a34a" },
          { label: "Avg Response",      value: avg_response_days != null ? `${avg_response_days}d` : "—",
            sub: "days to hear back",    color: "#f59e0b" },
          { label: "Ghosted",           value: ghost_count,             sub: ">30 days no reply",        color: "#dc2626" },
        ].map(m => (
          <div key={m.label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: m.color, lineHeight: 1 }}>{m.value}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", marginTop: 4 }}>{m.label}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{m.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, marginBottom: 16 }}>

        {/* ── Career Funnel ─────────────────────────────────────── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px" }}>
          <h2 style={sectionTitle}>Career Funnel</h2>
          {[
            { label: "Applied",        n: funnel.applied,    color: "#2563eb", pct: null },
            { label: "Recruiter Response", n: funnel.responded, color: "#0891b2",
              pct: funnel.applied ? `${response_rate}%` : null },
            { label: "Interviews",     n: funnel.interview,  color: "#7c3aed",
              pct: funnel.responded ? `${Math.round(funnel.interview / funnel.responded * 100)}%` : null },
            { label: "Offers",         n: funnel.offer,      color: "#16a34a",
              pct: funnel.interview ? `${Math.round(funnel.offer / funnel.interview * 100)}%` : null },
          ].map((row, i, arr) => (
            <div key={row.label}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
                {/* bar */}
                <div style={{
                  height: 32,
                  width: `${Math.max(12, (row.n / (arr[0].n || 1)) * 100)}%`,
                  background: row.color + "22",
                  border: `2px solid ${row.color}`,
                  borderRadius: 6,
                  display: "flex", alignItems: "center", paddingLeft: 8,
                  transition: "width 0.4s",
                  minWidth: 40,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: row.color }}>{row.n}</span>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{row.label}</div>
                  {row.pct && <div style={{ fontSize: 11, color: "#94a3b8" }}>{row.pct} pass-through</div>}
                </div>
              </div>
              {i < arr.length - 1 && (
                <div style={{ fontSize: 16, color: "#cbd5e1", paddingLeft: 16 }}>↓</div>
              )}
            </div>
          ))}
          {funnel.rejected > 0 && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: "#fef2f2", borderRadius: 6, fontSize: 12 }}>
              <span style={{ color: "#dc2626", fontWeight: 700 }}>❌ {funnel.rejected}</span>
              <span style={{ color: "#94a3b8" }}> rejected</span>
            </div>
          )}
        </div>

        {/* ── Weekly Trend ──────────────────────────────────────── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px" }}>
          <h2 style={sectionTitle}>Weekly Applications</h2>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, marginBottom: 8 }}>
            {weekly_trend.map(w => (
              <div key={w.week} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>
                  {w.count > 0 ? w.count : ""}
                </div>
                <div style={{
                  width: "100%",
                  height: `${Math.max(4, (w.count / maxWeek) * 90)}px`,
                  background: w.count > 0 ? "#2563eb" : "#e2e8f0",
                  borderRadius: "4px 4px 0 0",
                  transition: "height 0.4s",
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {weekly_trend.map(w => (
              <div key={w.week} style={{ flex: 1, fontSize: 9, color: "#94a3b8", textAlign: "center", overflow: "hidden" }}>
                {w.week.replace(/\d{4}/, "").trim()}
              </div>
            ))}
          </div>

          {/* Salary insight */}
          {salary.avg_min && (
            <div style={{ marginTop: 16, padding: "10px 14px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #bbf7d0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#166534", marginBottom: 4 }}>
                💰 Salary Insight ({salary.sample_size} tracked jobs with salary data)
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d" }}>
                ${(salary.avg_min / 1000).toFixed(0)}k – ${(salary.avg_max! / 1000).toFixed(0)}k avg range
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                based on jobs in your tracker with listed salaries
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* ── Activity Feed ─────────────────────────────────────── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px" }}>
          <h2 style={sectionTitle}>Activity Feed</h2>
          {activity_feed.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Connect Gmail and sync to see your activity feed.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0, maxHeight: 340, overflowY: "auto" }}>
              {activity_feed.map((item, i) => {
                const meta = STATUS_META[item.status || ""] ?? { emoji: "📧", color: "#94a3b8", label: "" };
                const dateStr = item.date ? new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
                return (
                  <div
                    key={i}
                    onClick={() => item.job_id && onSelectJob(item.job_id)}
                    style={{
                      display: "flex", gap: 10, padding: "8px 0",
                      borderBottom: i < activity_feed.length - 1 ? "1px solid #f1f5f9" : "none",
                      cursor: item.job_id ? "pointer" : "default",
                    }}
                  >
                    <div style={{ fontSize: 16, flexShrink: 0 }}>{meta.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {item.status && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: meta.color,
                            background: meta.color + "18", borderRadius: 99, padding: "1px 6px" }}>
                            {meta.label || item.status}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{dateStr}</span>
                        {item.company && <span style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{item.company}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.subject}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── AI Reply Templates ────────────────────────────────── */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px" }}>
          <h2 style={sectionTitle}>📬 AI Reply Templates</h2>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 12px" }}>
            Ready-to-send drafts based on your detected emails. Click to expand, copy to clipboard.
          </p>
          {reply_templates.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              No reply templates yet — sync Gmail to detect emails that need responses.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 340, overflowY: "auto" }}>
              {reply_templates.map(t => {
                const meta = STATUS_META[t.status || ""] ?? { emoji: "📧", color: "#94a3b8", label: t.status || "" };
                const isOpen = expandedTemplate === t.event_id;
                return (
                  <div key={t.event_id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                    <button
                      onClick={() => setExpandedTemplate(isOpen ? null : t.event_id)}
                      style={{
                        width: "100%", padding: "9px 12px", background: isOpen ? "#f8fafc" : "#fff",
                        border: "none", cursor: "pointer", textAlign: "left",
                        display: "flex", alignItems: "center", gap: 8,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{meta.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: meta.color }}>{meta.label}</div>
                        <div style={{ fontSize: 11, color: "#64748b",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {t.company} — {t.subject}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{isOpen ? "▲" : "▼"}</span>
                    </button>
                    {isOpen && (
                      <div style={{ padding: "0 12px 12px" }}>
                        <pre style={{
                          margin: "0 0 8px", fontSize: 12, color: "#374151", lineHeight: 1.6,
                          whiteSpace: "pre-wrap", fontFamily: "inherit",
                          background: "#f8fafc", borderRadius: 6, padding: "10px 12px",
                        }}>
                          {t.template}
                        </pre>
                        <button
                          onClick={() => copyTemplate(t.event_id, t.template)}
                          style={{
                            padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                            border: "none", cursor: "pointer",
                            background: copiedId === t.event_id ? "#16a34a" : "#2563eb",
                            color: "#fff",
                          }}
                        >
                          {copiedId === t.event_id ? "✓ Copied!" : "Copy to Clipboard"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Compensation Intelligence ─────────────────────────── */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px" }}>
        <h2 style={sectionTitle}>💰 Compensation Intelligence</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {[
            { label: "Entry / Mid AI Engineer",       range: "$140k – $200k",  note: "2–5 yrs, non-FAANG" },
            { label: "Senior AI / ML Engineer",       range: "$200k – $290k",  note: "5–10 yrs, FAANG/growth" },
            { label: "Staff / Principal ML",          range: "$300k – $450k+", note: "TC with equity" },
            { label: "Environmental Data Scientist",  range: "$90k – $145k",   note: "Gov / nonprofit / consulting" },
            { label: "Climate Tech / HPC roles",      range: "$130k – $220k",  note: "Energy + compute-heavy" },
            { label: "Research Scientist (Lab)",      range: "$180k – $320k",  note: "National labs / big tech research" },
          ].map(c => (
            <div key={c.label} style={{ padding: "12px 14px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#16a34a" }}>{c.range}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{c.note}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: "#94a3b8" }}>
          Market estimates for 2025–2026 · US market · TC = total compensation including equity · Source: levels.fyi, H1B data, LinkedIn salary
        </div>
      </div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: "#1a202c", margin: "0 0 14px",
};
