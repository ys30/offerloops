import { useCallback, useEffect, useState } from "react";
import { fetchEmailEvents, fetchFollowups, fetchGmailStatus, fetchTracker, syncGmail, updateJobStatus } from "../api";
import type { EmailEvent, Job, User } from "../types";
import { fetchJobs } from "../api";

type FollowupJob = Job & { followup_due_days: number; days_overdue: number };

const COLUMNS: { key: string; label: string; color: string; bg: string }[] = [
  { key: "not_interested", label: "Not Interested", color: "#78716c", bg: "#f5f5f4" },
  { key: "interested",     label: "Interested",     color: "#6366f1", bg: "#eef2ff" },
  { key: "applied",        label: "Applied",        color: "#2563eb", bg: "#eff6ff" },
  { key: "phone_screen",   label: "Phone Screen",   color: "#0891b2", bg: "#ecfeff" },
  { key: "interview",      label: "Interview",      color: "#7c3aed", bg: "#f5f3ff" },
  { key: "offer",          label: "Offer",          color: "#16a34a", bg: "#f0fdf4" },
  { key: "rejected",       label: "Rejected",       color: "#dc2626", bg: "#fef2f2" },
  { key: "withdrawn",      label: "Withdrawn",      color: "#94a3b8", bg: "#f8fafc" },
];

interface Props {
  user: User | null;
  onSelectJob: (id: string) => void;
}

export default function TrackerPage({ user, onSelectJob }: Props) {
  const [grouped, setGrouped] = useState<Record<string, Job[]>>({});
  const [loading, setLoading] = useState(true);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [followups, setFollowups] = useState<FollowupJob[]>([]);
  // email events keyed by job_id
  const [eventsByJob, setEventsByJob] = useState<Record<string, EmailEvent[]>>({});
  // email events with no matched job
  const [unmatchedEvents, setUnmatchedEvents] = useState<EmailEvent[]>([]);
  // jobs available for linking
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [linkingEvent, setLinkingEvent] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [data, fu] = await Promise.all([fetchTracker(), fetchFollowups()]);
      setGrouped(data);
      setFollowups(fu);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const loadEmailEvents = useCallback(async () => {
    if (!user) return;
    const events = await fetchEmailEvents();
    const byJob: Record<string, EmailEvent[]> = {};
    const unmatched: EmailEvent[] = [];
    for (const ev of events) {
      if (ev.job_id) {
        (byJob[ev.job_id] ??= []).push(ev);
      } else if (ev.detected_status) {
        unmatched.push(ev);
      }
    }
    setEventsByJob(byJob);
    setUnmatchedEvents(unmatched);
  }, [user]);

  useEffect(() => {
    load();
    fetchJobs({ limit: 200 }).then(r => setAllJobs(r.jobs)).catch(() => null);
    if (user) {
      fetchGmailStatus().then(async s => {
        setGmailConnected(s.connected);
        setLastSynced(s.last_synced_at ?? null);
        // Auto-sync if Gmail is connected and last sync was >15 minutes ago (or never)
        if (s.connected) {
          const lastSyncMs = s.last_synced_at ? new Date(s.last_synced_at).getTime() : 0;
          const staleMs = Date.now() - lastSyncMs;
          if (staleMs > 15 * 60 * 1000) {
            setSyncing(true);
            try {
              const r = await syncGmail(60);
              if (r.jobs_updated > 0) {
                setSyncMsg(`📬 Auto-synced: ${r.jobs_updated} status${r.jobs_updated !== 1 ? "es" : ""} updated`);
              }
              setLastSynced(new Date().toISOString());
              await load();
              await loadEmailEvents();
            } catch { /* silent */ }
            finally { setSyncing(false); }
          }
        }
      }).catch(() => null);
      loadEmailEvents();
    }
  }, [load, loadEmailEvents, user]);

  async function moveJob(jobId: string, newStatus: string) {
    await updateJobStatus(jobId, newStatus);
    load();
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await syncGmail(60);
      setSyncMsg(`📬 ${r.new_events} new emails · ${r.jobs_updated} statuses auto-updated`);
      setLastSynced(new Date().toISOString());
      await load();
      await loadEmailEvents();
    } catch (e: unknown) {
      setSyncMsg(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function linkUnmatchedToJob(eventId: string, jobId: string) {
    setLinkingEvent(eventId);
    try {
      await fetch(`/api/gmail/events/${eventId}/link`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("ol_token")}` },
        body: JSON.stringify({ job_id: jobId }),
      });
      await Promise.all([load(), loadEmailEvents()]);
    } catch { /* ignore */ }
    finally { setLinkingEvent(null); }
  }

  const total = Object.values(grouped).reduce((n, jobs) => n + jobs.length, 0);

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>Loading…</div>;

  return (
    <div>
      {/* Follow-up reminders */}
      {followups.length > 0 && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: "12px 16px", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#92400e", marginBottom: 8 }}>
            ⏰ {followups.length} follow-up{followups.length > 1 ? "s" : ""} due
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {followups.slice(0, 5).map(job => (
              <div key={job.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{
                  background: job.days_overdue > 3 ? "#dc2626" : "#f59e0b",
                  color: "#fff", borderRadius: 99, padding: "1px 8px", fontSize: 11, whiteSpace: "nowrap"
                }}>
                  {job.days_overdue === 0 ? "due today" : `${job.days_overdue}d overdue`}
                </span>
                <button
                  onClick={() => onSelectJob(job.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#1e293b", fontWeight: 600, padding: 0, textAlign: "left" }}
                >
                  {job.company} — {job.title}
                </button>
                <span style={{ color: "#94a3b8", fontSize: 11 }}>({job.status})</span>
              </div>
            ))}
            {followups.length > 5 && (
              <div style={{ fontSize: 12, color: "#92400e" }}>+{followups.length - 5} more</div>
            )}
          </div>
        </div>
      )}
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1e293b" }}>Application Tracker</h2>
        <span style={{ fontSize: 12, color: "#94a3b8", background: "#f1f5f9", borderRadius: 99, padding: "2px 10px" }}>
          {total} tracked
        </span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {user && gmailConnected ? (
            <>
              <button
                onClick={handleSync}
                disabled={syncing}
                style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                  border: "1px solid #bfdbfe", background: "#eff6ff", color: "#2563eb",
                  cursor: syncing ? "not-allowed" : "pointer", opacity: syncing ? 0.7 : 1,
                }}
              >
                {syncing ? "Scanning…" : "📬 Sync Gmail"}
              </button>
              {lastSynced && (
                <span style={{ fontSize: 11, color: "#94a3b8" }}>
                  Last: {new Date(lastSynced).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </>
          ) : user ? (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              Connect Gmail in Profile for auto-sync
            </span>
          ) : null}
        </div>
      </div>

      {syncMsg && (
        <div style={{
          marginBottom: 12, padding: "8px 14px", borderRadius: 7, fontSize: 12, fontWeight: 600,
          background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0",
        }}>
          {syncMsg}
        </div>
      )}

      {total === 0 && unmatchedEvents.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div>No applications tracked yet.</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Open a job and set its status, or sync Gmail to auto-detect.</div>
        </div>
      ) : (
        <>
          {total > 0 && (
            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 16, alignItems: "flex-start" }}>
              {COLUMNS.map(col => {
                const jobs = grouped[col.key] ?? [];
                return (
                  <div key={col.key} style={{ minWidth: 240, maxWidth: 260, flexShrink: 0 }}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6,
                      marginBottom: 10, padding: "6px 10px",
                      background: col.bg, borderRadius: 7,
                      borderLeft: `3px solid ${col.color}`,
                    }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: col.color }}>{col.label}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11, color: col.color, fontWeight: 600 }}>
                        {jobs.length}
                      </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {jobs.map(job => (
                        <TrackerCard
                          key={job.id}
                          job={job}
                          currentCol={col}
                          emailEvents={eventsByJob[job.id] ?? []}
                          onOpen={() => onSelectJob(job.id)}
                          onMove={newStatus => moveJob(job.id, newStatus)}
                          onRemove={() => moveJob(job.id, "new")}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {unmatchedEvents.length > 0 && (
            <div style={{ marginTop: total > 0 ? 24 : 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", marginBottom: 10 }}>
                📬 Email-detected applications not yet linked to a job ({unmatchedEvents.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {unmatchedEvents.map(ev => (
                  <div key={ev.id} style={{
                    background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
                    padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>
                        {ev.company_guess || "Unknown company"}
                        {ev.role_guess && <span style={{ fontWeight: 400, color: "#64748b" }}> — {ev.role_guess}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                        {ev.email_date ? new Date(ev.email_date).toLocaleDateString() : ""} · {ev.subject}
                      </div>
                    </div>
                    {ev.detected_status && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, whiteSpace: "nowrap",
                        background: STATUS_COLORS[ev.detected_status] ? STATUS_COLORS[ev.detected_status] + "22" : "#f1f5f9",
                        color: STATUS_COLORS[ev.detected_status] ?? "#64748b",
                        border: `1px solid ${STATUS_COLORS[ev.detected_status] ?? "#e2e8f0"}40`,
                      }}>
                        {ev.detected_status.replace("_", " ")}
                      </span>
                    )}
                    <select
                      defaultValue=""
                      disabled={linkingEvent === ev.id}
                      onChange={e => { if (e.target.value) linkUnmatchedToJob(ev.id, e.target.value); }}
                      onClick={e => e.stopPropagation()}
                      style={{
                        fontSize: 11, padding: "4px 8px", borderRadius: 6,
                        border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer",
                        color: "#374151", maxWidth: 200,
                      }}
                    >
                      <option value="">Link to job…</option>
                      {allJobs.map(j => (
                        <option key={j.id} value={j.id}>{j.company} — {j.title}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TrackerCard({ job, currentCol, emailEvents, onOpen, onMove, onRemove }: {
  job: Job;
  currentCol: typeof COLUMNS[number];
  emailEvents: EmailEvent[];
  onOpen: () => void;
  onMove: (status: string) => void;
  onRemove: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const [showEmails, setShowEmails] = useState(false);

  async function handleMove(e: React.ChangeEvent<HTMLSelectElement>) {
    setMoving(true);
    await onMove(e.target.value);
    setMoving(false);
  }

  async function handleRemove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Remove "${job.title}" from tracker?`)) return;
    setMoving(true);
    await onRemove();
  }

  const latestEmail = emailEvents[0];

  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
      overflow: "hidden", opacity: moving ? 0.5 : 1,
    }}>
      {/* Main card body */}
      <div onClick={onOpen} style={{ padding: "10px 12px", cursor: "pointer" }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b", marginBottom: 2, lineHeight: 1.3 }}>
          {job.title}
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>{job.company}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
          {job.ai_score != null && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
              background: job.ai_score >= 4 ? "#dcfce7" : job.ai_score >= 3 ? "#fef9c3" : "#fee2e2",
              color: job.ai_score >= 4 ? "#166534" : job.ai_score >= 3 ? "#92400e" : "#991b1b",
            }}>
              {job.ai_score.toFixed(1)}/5
            </span>
          )}
          {job.applied_date && (
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              Applied {job.applied_date.slice(0, 10)}
            </span>
          )}
        </div>

        {job.notes && (
          <div style={{
            fontSize: 11, color: "#64748b", marginTop: 5, fontStyle: "italic",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {job.notes}
          </div>
        )}
      </div>

      {/* Email events strip */}
      {emailEvents.length > 0 && (
        <div style={{ borderTop: "1px solid #f1f5f9" }}>
          <button
            onClick={e => { e.stopPropagation(); setShowEmails(v => !v); }}
            style={{
              width: "100%", padding: "5px 12px", background: "none", border: "none",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              fontSize: 11, color: "#2563eb", fontWeight: 600,
            }}
          >
            <span>📬 {emailEvents.length} email{emailEvents.length !== 1 ? "s" : ""}</span>
            {latestEmail?.detected_status && (
              <span style={{ color: "#94a3b8", fontWeight: 400 }}>
                · {latestEmail.detected_status.replace("_", " ")}
              </span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 10 }}>{showEmails ? "▲" : "▼"}</span>
          </button>

          {showEmails && (
            <div style={{ padding: "4px 12px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
              {emailEvents.slice(0, 5).map(ev => (
                <div key={ev.id} style={{ fontSize: 11 }}>
                  <div style={{ color: "#64748b" }}>
                    {ev.email_date ? new Date(ev.email_date).toLocaleDateString() : ""}
                    {ev.detected_status && (
                      <span style={{
                        marginLeft: 6, fontWeight: 700,
                        color: STATUS_COLORS[ev.detected_status] ?? "#94a3b8",
                      }}>
                        {ev.detected_status.replace("_", " ")}
                      </span>
                    )}
                  </div>
                  <div style={{ color: "#1e293b", fontWeight: 500, lineHeight: 1.3 }}>{ev.subject}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Move dropdown + remove */}
      <div style={{ padding: "6px 10px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 6, alignItems: "center" }}>
        <select
          value={currentCol.key}
          onChange={handleMove}
          onClick={e => e.stopPropagation()}
          style={{
            flex: 1, fontSize: 11, padding: "4px 6px",
            border: `1px solid ${currentCol.color}40`,
            borderRadius: 5, color: currentCol.color,
            background: currentCol.bg, cursor: "pointer", fontWeight: 600,
          }}
        >
          {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <button
          onClick={handleRemove}
          title="Remove from tracker"
          style={{
            padding: "3px 8px", fontSize: 12, fontWeight: 700,
            background: "#fef2f2", color: "#dc2626",
            border: "1px solid #fecaca", borderRadius: 5, cursor: "pointer", flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  not_interested: "#78716c",
  interested:     "#6366f1",
  applied:        "#2563eb",
  phone_screen:   "#0891b2",
  interview:      "#7c3aed",
  offer:          "#16a34a",
  rejected:       "#dc2626",
  withdrawn:      "#94a3b8",
};
