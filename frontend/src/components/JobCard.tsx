import { useState } from "react";
import type { Job } from "../types";

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  not_interested: { color: "#78716c", bg: "#f5f5f4" },
  interested:     { color: "#6366f1", bg: "#eef2ff" },
  applied:        { color: "#2563eb", bg: "#eff6ff" },
  phone_screen:   { color: "#0891b2", bg: "#ecfeff" },
  interview:      { color: "#7c3aed", bg: "#f5f3ff" },
  offer:          { color: "#16a34a", bg: "#f0fdf4" },
  rejected:       { color: "#dc2626", bg: "#fef2f2" },
  withdrawn:      { color: "#94a3b8", bg: "#f8fafc" },
};

const STATUS_LABELS: Record<string, string> = {
  not_interested: "Not Interested", interested: "Interested", applied: "Applied",
  phone_screen: "Phone Screen", interview: "Interview", offer: "Offer",
  rejected: "Rejected", withdrawn: "Withdrawn",
};

const SOURCE_COLORS: Record<string, string> = {
  usajobs: "#0050d8",
  greenhouse: "#24b47e",
  lever: "#6666ff",
  manual: "#888",
};

function formatSalary(job: Job): string {
  if (!job.salary || (!job.salary.min && !job.salary.max)) return "";
  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;
  const period = job.salary.period === "hourly" ? "/hr" : "/yr";
  if (job.salary.min && job.salary.max)
    return `${fmt(job.salary.min)}–${fmt(job.salary.max)}${period}`;
  return `${fmt(job.salary.min ?? job.salary.max ?? 0)}${period}`;
}

function formatLocation(job: Job): string {
  if (job.location.remote) return "Remote";
  const parts = [job.location.city, job.location.state].filter(Boolean);
  return parts.join(", ") || job.location.raw || "";
}

interface Props {
  job: Job;
  onSelect: (id: string) => void;
  onStatusChange?: (jobId: string, status: string) => void;
}

const STATUS_OPTIONS = [
  { key: "new",            label: "New" },
  { key: "not_interested", label: "Not Interested" },
  { key: "interested",     label: "Interested" },
  { key: "applied",        label: "Applied" },
  { key: "phone_screen",   label: "Phone Screen" },
  { key: "interview",      label: "Interview" },
  { key: "offer",          label: "Offer" },
  { key: "rejected",       label: "Rejected" },
  { key: "withdrawn",      label: "Withdrawn" },
];

export default function JobCard({ job, onSelect, onStatusChange }: Props) {
  const [currentStatus, setCurrentStatus] = useState(job.status || "new");
  const [saving, setSaving] = useState(false);
  const color = SOURCE_COLORS[job.source] ?? "#555";
  const score = job.ai_score;

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation();
    const newStatus = e.target.value;
    setCurrentStatus(newStatus);
    if (!onStatusChange) return;
    setSaving(true);
    try { await onStatusChange(job.id, newStatus); }
    finally { setSaving(false); }
  }

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "14px 16px",
        cursor: "pointer",
        background: "#fff",
        transition: "box-shadow 0.15s",
      }}
      onClick={() => onSelect(job.id)}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.1)")}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: "#1a202c", marginBottom: 2 }}>
            {job.title}
          </div>
          <div style={{ color: "#4a5568", fontSize: 13 }}>{job.company}</div>
        </div>
        {score != null && (
          <div
            style={{
              background: score >= 4 ? "#c6f6d5" : score >= 3 ? "#fef9c3" : "#fee2e2",
              color: score >= 4 ? "#276749" : score >= 3 ? "#92400e" : "#9b1c1c",
              borderRadius: 20,
              padding: "2px 10px",
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {score.toFixed(1)}/5
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#718096" }}>{formatLocation(job)}</span>
        {formatSalary(job) && (
          <span style={{ fontSize: 12, color: "#718096" }}>· {formatSalary(job)}</span>
        )}
        <span style={{ fontSize: 11, background: color + "22", color, borderRadius: 4, padding: "1px 7px", fontWeight: 600 }}>
          {job.source.toUpperCase()}
        </span>
        {job.location.remote && (
          <span style={{ fontSize: 11, background: "#e0f2fe", color: "#0369a1", borderRadius: 4, padding: "1px 7px" }}>
            Remote
          </span>
        )}
        {onStatusChange ? (
          <select
            value={currentStatus}
            onChange={handleStatusChange}
            onClick={e => e.stopPropagation()}
            disabled={saving}
            style={{
              fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, cursor: "pointer",
              border: `1px solid ${STATUS_COLORS[currentStatus]?.color ?? "#e2e8f0"}40`,
              background: STATUS_COLORS[currentStatus]?.bg ?? "#f8fafc",
              color: STATUS_COLORS[currentStatus]?.color ?? "#64748b",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {STATUS_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        ) : (
          currentStatus && currentStatus !== "new" && STATUS_COLORS[currentStatus] && (
            <span style={{
              fontSize: 11, fontWeight: 600, borderRadius: 4, padding: "1px 7px",
              background: STATUS_COLORS[currentStatus].bg,
              color: STATUS_COLORS[currentStatus].color,
            }}>
              {STATUS_LABELS[currentStatus]}
            </span>
          )
        )}
      </div>

      {job.ai_summary && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#4a5568", fontStyle: "italic" }}>
          {job.ai_summary}
        </div>
      )}

      {job.tags.filter(Boolean).length > 0 && (
        <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {job.tags.filter(Boolean).slice(0, 4).map(t => (
            <span
              key={t}
              style={{ fontSize: 11, background: "#f1f5f9", color: "#475569", borderRadius: 4, padding: "1px 6px" }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
