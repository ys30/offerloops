import { useEffect, useState } from "react";
import type { EmailEvent, Job } from "../types";
import { analyzeJob, createStory, fetchEmailEvents, generateApplicationPack, getToken, linkStory, recommendStories, refreshJobDescription, scoreStoriesAI, unlinkStory, updateJobStatus } from "../api";
import type { Story } from "../api";
import ApplicationPack from "./ApplicationPack";

const STATUSES = [
  { key: "new",            label: "New",              color: "#64748b" },
  { key: "saved",          label: "Saved",            color: "#d97706" },
  { key: "not_interested", label: "Not Interested",   color: "#78716c" },
  { key: "interested",     label: "Interested",       color: "#6366f1" },
  { key: "applied",        label: "Applied",          color: "#2563eb" },
  { key: "phone_screen",   label: "Phone Screen",     color: "#0891b2" },
  { key: "interview",      label: "Interview",        color: "#7c3aed" },
  { key: "offer",          label: "Offer",            color: "#16a34a" },
  { key: "rejected",       label: "Rejected",         color: "#dc2626" },
  { key: "withdrawn",      label: "Withdrawn",        color: "#94a3b8" },
  { key: "closed",         label: "No Longer Open",   color: "#475569" },
];

const STATUS_COLORS: Record<string, string> = Object.fromEntries(STATUSES.map(s => [s.key, s.color]));

interface Props {
  job: Job;
  onBack: () => void;
  onDeleted: (id: string) => void;
}

const PROVIDERS = [
  { id: "nvidia",    label: "NVIDIA NIM · Nemotron 70B", auto: true },
  { id: "anthropic", label: "Claude Opus 4.7",   auto: false },
  { id: "openai",    label: "GPT-4o",             auto: false },
  { id: "gemini",    label: "Gemini 1.5 Pro",     auto: false },
];

export default function JobDetail({ job, onBack, onDeleted }: Props) {
  const [resume, setResume] = useState("");
  const [provider, setProvider] = useState(() => localStorage.getItem("ol_ai_provider") || "nvidia");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("ol_ai_key") || "");
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [pack, setPack] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [emailEvents, setEmailEvents] = useState<EmailEvent[]>([]);
  useEffect(() => {
    if (getToken()) {
      fetchEmailEvents(job.id).then(setEmailEvents).catch(() => null);
    }
  }, [job.id]);

  const [status, setStatus] = useState(job.status || "new");
  const [notes, setNotes] = useState(job.notes || "");
  const [appliedDate, setAppliedDate] = useState(
    job.applied_date ? job.applied_date.slice(0, 10) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [description, setDescription] = useState(job.description);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  // STAR stories — pool model with recommendations
  const [stories, setStories] = useState<Story[]>([]);
  const [showStoryForm, setShowStoryForm] = useState(false);
  const [storyDraft, setStoryDraft] = useState({ title: "", situation: "", task: "", action: "", result: "", skills: "" });
  const [savingStory, setSavingStory] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [aiScoringStories, setAiScoringStories] = useState(false);
  const [storyScoreError, setStoryScoreError] = useState("");

  useEffect(() => {
    if (getToken()) recommendStories(job.id).then(setStories).catch(() => null);
  }, [job.id]);

  async function handleSaveStory() {
    setSavingStory(true);
    try {
      const s = await createStory({
        title: storyDraft.title,
        situation: storyDraft.situation,
        task: storyDraft.task,
        action: storyDraft.action,
        result: storyDraft.result,
        skills: storyDraft.skills.split(",").map(s => s.trim()).filter(Boolean),
        linked_job_ids: [job.id],
        ai_polished: false,
      });
      setStories(prev => [{ ...s, linked: true, relevance_score: 0 }, ...prev]);
      setStoryDraft({ title: "", situation: "", task: "", action: "", result: "", skills: "" });
      setShowStoryForm(false);
    } catch { /* ignore */ }
    finally { setSavingStory(false); }
  }

  async function handleToggleLink(s: Story) {
    setLinkingId(s.id);
    try {
      if (s.linked) {
        const updated = await unlinkStory(s.id, job.id);
        setStories(prev => prev.map(x => x.id === s.id ? { ...updated, linked: false, relevance_score: x.relevance_score } : x));
      } else {
        const updated = await linkStory(s.id, job.id);
        setStories(prev => prev.map(x => x.id === s.id ? { ...updated, linked: true, relevance_score: x.relevance_score } : x));
      }
    } catch { /* ignore */ }
    finally { setLinkingId(null); }
  }

  async function persist(overrides: { status?: string; notes?: string; appliedDate?: string } = {}) {
    const s = overrides.status ?? status;
    const n = overrides.notes ?? notes;
    const d = overrides.appliedDate ?? appliedDate;
    setSaving(true);
    try {
      await updateJobStatus(job.id, s, n, d || undefined);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    setStatus(newStatus);
    await persist({ status: newStatus });
  }

  async function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const d = e.target.value;
    setAppliedDate(d);
    await persist({ appliedDate: d });
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setError("");
    try {
      const r = await analyzeJob(job.id, resume || undefined, provider, apiKey || undefined);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  const score = result ? (result.score as number) : job.ai_score;

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "0 16px 80px" }}>
      <button onClick={onBack} style={btnStyle("#f1f5f9", "#334155")}>← Back</button>

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, color: "#1a202c" }}>{job.title}</h1>
            <div style={{ color: "#4a5568", marginTop: 4 }}>{job.company}</div>
          </div>
          {score != null && (
            <div style={{
              background: score >= 4 ? "#c6f6d5" : score >= 3 ? "#fef9c3" : "#fee2e2",
              color: score >= 4 ? "#276749" : score >= 3 ? "#92400e" : "#9b1c1c",
              borderRadius: 8,
              padding: "6px 16px",
              fontWeight: 700,
              fontSize: 18,
            }}>
              {score.toFixed(1)} / 5
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13, color: "#718096" }}>
          {job.location.remote
            ? <span>📍 Remote</span>
            : <span>📍 {[job.location.city, job.location.state].filter(Boolean).join(", ") || job.location.raw}</span>
          }
          {job.salary?.min && <span>💰 ${(job.salary.min/1000).toFixed(0)}k–${(job.salary.max!/1000).toFixed(0)}k/{job.salary.period === "hourly" ? "hr" : "yr"}</span>}
          {job.posted_date && <span>📅 {job.posted_date.slice(0, 10)}</span>}
          {job.deadline && <span>⏰ Deadline: {job.deadline.slice(0, 10)}</span>}
          <span style={{ textTransform: "uppercase", fontWeight: 600 }}>{job.source}</span>
        </div>

        {job.apply_url && (
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-block", marginTop: 14, padding: "8px 20px", background: "#2563eb", color: "#fff", borderRadius: 6, textDecoration: "none", fontSize: 14, fontWeight: 600 }}
          >
            Apply →
          </a>
        )}

        {job.ai_summary && (
          <div style={{ marginTop: 16, padding: 12, background: "#f0fdf4", borderRadius: 8, borderLeft: "3px solid #22c55e", fontSize: 13, color: "#166534", fontStyle: "italic" }}>
            {job.ai_summary}
          </div>
        )}

        {result && (
          <div style={{ marginTop: 16, padding: 14, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>AI Analysis</div>
            <p style={{ margin: "0 0 8px", fontSize: 13 }}>{result.summary as string}</p>
            {(result.fit_reasons as string[])?.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#166534", marginBottom: 4 }}>Strengths</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {(result.fit_reasons as string[]).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
            {(result.gap_reasons as string[])?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#9b1c1c", marginBottom: 4 }}>Gaps</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {(result.gap_reasons as string[]).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <section style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15, color: "#1a202c" }}>Description</h3>
            <button
              onClick={async () => {
                setRefreshing(true);
                setRefreshError("");
                try {
                  const updated = await refreshJobDescription(job.id);
                  setDescription(updated.description);
                } catch (e: unknown) {
                  setRefreshError(e instanceof Error ? e.message : "Refresh failed");
                } finally {
                  setRefreshing(false);
                }
              }}
              disabled={refreshing}
              title="Re-fetch full description from source"
              style={{
                fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5,
                border: "1px solid #e2e8f0", background: "#f8fafc", color: "#2563eb",
                cursor: refreshing ? "not-allowed" : "pointer", opacity: refreshing ? 0.6 : 1,
              }}
            >
              {refreshing ? "Fetching…" : "↻ Refresh"}
            </button>
            {refreshError && <span style={{ fontSize: 11, color: "#dc2626" }}>{refreshError}</span>}
          </div>
          <div
            style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}
            dangerouslySetInnerHTML={{ __html: description.replace(/<[^>]+>/g, " ").trim() }}
          />
        </section>

        {job.requirements.length > 0 && (
          <section style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 15, color: "#1a202c", marginBottom: 8 }}>Requirements</h3>
            <ul style={{ paddingLeft: 18, fontSize: 13, color: "#374151", lineHeight: 1.8 }}>
              {job.requirements.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </section>
        )}

        <section style={{ marginTop: 24, padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>AI Job Fit Analysis</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => { setProvider(p.id); localStorage.setItem("ol_ai_provider", p.id); }}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  border: "1px solid #e2e8f0",
                  borderRadius: 5,
                  cursor: "pointer",
                  background: provider === p.id ? "#2563eb" : "#fff",
                  color: provider === p.id ? "#fff" : "#374151",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <textarea
            value={resume}
            onChange={e => setResume(e.target.value)}
            placeholder="Paste your resume here — or leave blank to use your saved profile resume"
            rows={5}
            style={textareaStyle}
          />
          {PROVIDERS.find(p => p.id === provider)?.auto ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "#16a34a", padding: "6px 10px", background: "#f0fdf4", borderRadius: 5, border: "1px solid #bbf7d0" }}>
              ✓ Built-in key — no API key needed
            </div>
          ) : (
            <input
              type="password"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); localStorage.setItem("ol_ai_key", e.target.value); }}
              placeholder={`${PROVIDERS.find(p => p.id === provider)?.label} API key`}
              style={{ ...inputStyle, marginTop: 8 }}
            />
          )}
          {error && <div style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              onClick={handleAnalyze}
              disabled={analyzing || generating}
              style={btnStyle("#2563eb", "#fff")}
            >
              {analyzing ? "Scoring…" : `Score fit`}
            </button>
            <button
              onClick={async () => {
                setGenerating(true);
                setError("");
                try {
                  const r = await generateApplicationPack(job.id, resume, provider, apiKey || undefined);
                  setPack(r);
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setGenerating(false);
                }
              }}
              disabled={analyzing || generating}
              style={btnStyle("#059669", "#fff")}
            >
              {generating ? "Generating…" : "⚡ One-click Resume + Cover Letter"}
            </button>
          </div>
        </section>

        {pack && (
          <ApplicationPack
            result={pack as unknown as Parameters<typeof ApplicationPack>[0]["result"]}
            onClose={() => setPack(null)}
          />
        )}

        {/* Status tracker */}
        <section style={{ marginTop: 24, padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Application Status</h3>
            <span style={{ fontSize: 12, color: saving ? "#94a3b8" : saved ? "#16a34a" : "transparent" }}>
              {saving ? "Saving…" : "✓ Saved"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {STATUSES.map(s => (
              <button
                key={s.key}
                onClick={() => handleStatusChange(s.key)}
                style={{
                  padding: "5px 12px", fontSize: 12, fontWeight: 600,
                  border: `1px solid ${s.key === status ? s.color : "#e2e8f0"}`,
                  borderRadius: 99, cursor: "pointer",
                  background: s.key === status ? s.color : "#fff",
                  color: s.key === status ? "#fff" : "#64748b",
                  transition: "all 0.15s",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>Applied date</label>
            <input
              type="date"
              value={appliedDate}
              onChange={handleDateChange}
              style={{ padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, background: "#fff" }}
            />
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => persist()}
            placeholder="Notes — interview dates, contacts, follow-ups…"
            rows={3}
            style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
          />
        </section>

        {emailEvents.length > 0 && (
          <section style={{ marginTop: 24, padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>📬 Email Timeline</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {emailEvents.map((ev, i) => {
                const color = STATUS_COLORS[ev.detected_status || ""] || "#94a3b8";
                return (
                  <div key={ev.id} style={{ display: "flex", gap: 12, position: "relative" }}>
                    {/* vertical line */}
                    {i < emailEvents.length - 1 && (
                      <div style={{ position: "absolute", left: 7, top: 20, bottom: -8, width: 2, background: "#e2e8f0" }} />
                    )}
                    <div style={{
                      width: 16, height: 16, borderRadius: "50%", background: color,
                      flexShrink: 0, marginTop: 3, zIndex: 1,
                    }} />
                    <div style={{ paddingBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {ev.detected_status && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 7px",
                            borderRadius: 99, background: color, color: "#fff",
                            textTransform: "capitalize",
                          }}>
                            {ev.detected_status.replace("_", " ")}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          {ev.email_date ? new Date(ev.email_date).toLocaleDateString() : ""}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a202c", marginTop: 2 }}>{ev.subject}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>{ev.snippet}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* STAR Story Bank */}
        {getToken() && (
          <section style={{ marginTop: 24, padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>
                📖 STAR Stories
                <span style={{ fontWeight: 400, fontSize: 12, color: "#64748b", marginLeft: 8 }}>
                  {stories.filter(s => s.linked).length} linked · {stories.length} from pool
                </span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={async () => {
                    setAiScoringStories(true);
                    setStoryScoreError("");
                    try {
                      const scored = await scoreStoriesAI(job.id, provider, apiKey || undefined);
                      setStories(scored);
                    } catch (e: unknown) {
                      setStoryScoreError(e instanceof Error ? e.message : "AI scoring failed");
                    } finally {
                      setAiScoringStories(false);
                    }
                  }}
                  disabled={aiScoringStories}
                  style={{ ...btnStyle("#7c3aed", "#fff"), marginTop: 0, fontSize: 11, padding: "4px 10px" }}
                >
                  {aiScoringStories ? "Scoring…" : "🤖 AI Score"}
                </button>
                <button onClick={() => setShowStoryForm(v => !v)} style={{ ...btnStyle("#6366f1", "#fff"), marginTop: 0 }}>
                  {showStoryForm ? "Cancel" : "+ New Story"}
                </button>
              </div>
            </div>
            {storyScoreError && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 8 }}>{storyScoreError}</div>}
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
              Keyword-ranked by default · click 🤖 AI Score for smarter relevance scoring.
            </div>

            {showStoryForm && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14, marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#374151", marginBottom: 10 }}>New Story → Added to Pool & Linked</div>
                {[
                  { key: "title", label: "Title", placeholder: "e.g. Led wildfire risk modeling project" },
                  { key: "situation", label: "Situation", placeholder: "What was the context?" },
                  { key: "task", label: "Task", placeholder: "What were you responsible for?" },
                  { key: "action", label: "Action", placeholder: "What did you do specifically?" },
                  { key: "result", label: "Result", placeholder: "What was the outcome? Include metrics!" },
                  { key: "skills", label: "Skills (comma-separated)", placeholder: "Python, GIS, stakeholder management" },
                ].map(({ key, label, placeholder }) => (
                  <div key={key} style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 3 }}>{label}</label>
                    <textarea
                      rows={key === "title" || key === "skills" ? 1 : 3}
                      placeholder={placeholder}
                      value={storyDraft[key as keyof typeof storyDraft]}
                      onChange={e => setStoryDraft(d => ({ ...d, [key]: e.target.value }))}
                      style={textareaStyle}
                    />
                  </div>
                ))}
                <button onClick={handleSaveStory} disabled={!storyDraft.title || savingStory} style={btnStyle("#6366f1", "#fff")}>
                  {savingStory ? "Saving…" : "Save & Link to This Job"}
                </button>
              </div>
            )}

            {stories.length === 0 && !showStoryForm ? (
              <div style={{ fontSize: 13, color: "#94a3b8" }}>
                No stories in your pool yet. Go to 📚 Stories to add some, or create one here.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {stories.map(s => {
                  const isLinked = !!s.linked;
                  const isLinking = linkingId === s.id;
                  return (
                    <div key={s.id} style={{
                      background: "#fff",
                      border: `1px solid ${isLinked ? "#a5b4fc" : "#e2e8f0"}`,
                      borderRadius: 8, padding: 12,
                      opacity: isLinking ? 0.6 : 1,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{s.title}</span>
                            {isLinked && (
                              <span style={{ fontSize: 11, background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 99, padding: "1px 7px" }}>
                                🔗 linked
                              </span>
                            )}
                            {s.ai_polished && (
                              <span style={{ fontSize: 11, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 99, padding: "1px 7px" }}>
                                ✨ polished
                              </span>
                            )}
                            {s.relevance_score !== undefined && s.relevance_score > 0 && (
                              <span
                                title={s.ai_reason || "keyword overlap score"}
                                style={{
                                  fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99,
                                  background: s.ai_reason
                                    ? (s.relevance_score >= 70 ? "#f0fdf4" : s.relevance_score >= 40 ? "#fefce8" : "#f8fafc")
                                    : "#f8fafc",
                                  color: s.ai_reason
                                    ? (s.relevance_score >= 70 ? "#16a34a" : s.relevance_score >= 40 ? "#ca8a04" : "#94a3b8")
                                    : "#94a3b8",
                                  border: `1px solid ${s.ai_reason
                                    ? (s.relevance_score >= 70 ? "#bbf7d0" : s.relevance_score >= 40 ? "#fef08a" : "#e2e8f0")
                                    : "#e2e8f0"}`,
                                  cursor: s.ai_reason ? "help" : "default",
                                }}
                              >
                                {s.ai_reason ? `AI ${s.relevance_score}` : `kw ${s.relevance_score}`}
                              </span>
                            )}
                          </div>
                          {s.skills?.length > 0 && (
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                              {s.skills.map(sk => (
                                <span key={sk} style={{ fontSize: 10, background: "#ede9fe", color: "#6d28d9", borderRadius: 99, padding: "2px 8px", fontWeight: 600 }}>{sk}</span>
                              ))}
                            </div>
                          )}
                          {[["Situation", s.situation], ["Task", s.task], ["Action", s.action], ["Result", s.result]].map(([label, text]) =>
                            text ? (
                              <div key={label as string} style={{ fontSize: 12, marginTop: 5 }}>
                                <span style={{ fontWeight: 700, color: "#6366f1" }}>{label}: </span>
                                <span style={{ color: "#374151" }}>{text}</span>
                              </div>
                            ) : null
                          )}
                        </div>
                        <button
                          onClick={() => handleToggleLink(s)}
                          disabled={isLinking}
                          style={{
                            padding: "4px 12px", fontSize: 12, fontWeight: 600,
                            border: `1px solid ${isLinked ? "#fca5a5" : "#a5b4fc"}`,
                            borderRadius: 6, cursor: "pointer", flexShrink: 0,
                            background: isLinked ? "#fef2f2" : "#eff6ff",
                            color: isLinked ? "#dc2626" : "#2563eb",
                          }}
                        >
                          {isLinking ? "…" : isLinked ? "Unlink" : "Link"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

const btnStyle = (bg: string, color: string): React.CSSProperties => ({
  marginTop: 10,
  padding: "8px 18px",
  background: bg,
  color,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
});

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
  boxSizing: "border-box",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  fontFamily: "inherit",
};
