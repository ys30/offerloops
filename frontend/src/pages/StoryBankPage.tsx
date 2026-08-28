import { useEffect, useState } from "react";
import {
  fetchStories, createStory, updateStory, deleteStory,
  polishStory, generateStories, type Story,
} from "../api";

interface Props {
  onBack: () => void;
}

function extractError(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    return obj.detail ?? raw;
  } catch {
    return raw;
  }
}

const CATEGORIES = [
  "Leadership", "Conflict Resolution", "Failure & Learning", "Innovation",
  "Scaling & Growth", "Optimization", "Research & Analysis",
  "Cross-team Collaboration", "Stakeholder Management",
  "Technical Achievement", "Communication", "Problem Solving",
];

const CATEGORY_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  "Leadership":              { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  "Conflict Resolution":     { bg: "#fefce8", color: "#a16207", border: "#fde68a" },
  "Failure & Learning":      { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  "Innovation":              { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
  "Scaling & Growth":        { bg: "#f0f9ff", color: "#0369a1", border: "#bae6fd" },
  "Optimization":            { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  "Research & Analysis":     { bg: "#faf5ff", color: "#7e22ce", border: "#e9d5ff" },
  "Cross-team Collaboration":{ bg: "#fff1f2", color: "#be123c", border: "#fecdd3" },
  "Stakeholder Management":  { bg: "#f0fdfa", color: "#0f766e", border: "#99f6e4" },
  "Technical Achievement":   { bg: "#f8fafc", color: "#334155", border: "#e2e8f0" },
  "Communication":           { bg: "#fdfce8", color: "#854d0e", border: "#fef08a" },
  "Problem Solving":         { bg: "#f5f3ff", color: "#6d28d9", border: "#ddd6fe" },
};

const EMPTY: Partial<Story> = {
  title: "", situation: "", task: "", action: "", result: "", reflection: "",
  category: "", skills: [], linked_job_ids: [], ai_polished: false,
};

export default function StoryBankPage({ onBack }: Props) {
  const [stories, setStories] = useState<Story[]>([]);
  const [editing, setEditing] = useState<Partial<Story> | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [polishingId, setPolishingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState("nvidia");
  const [apiKey, setApiKey] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    const data = await fetchStories();
    setStories(data);
  }

  function startNew() {
    setEditId(null);
    setEditing({ ...EMPTY });
  }

  function startEdit(s: Story) {
    setEditId(s.id);
    setEditing({ ...s });
  }

  async function save() {
    if (!editing || !editing.title?.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (editId) {
        const updated = await updateStory(editId, editing as any);
        setStories(ss => ss.map(s => s.id === editId ? updated : s));
      } else {
        const created = await createStory(editing as any);
        setStories(ss => [...ss, created]);
      }
      setEditing(null);
      setEditId(null);
    } catch (e: any) {
      setError(extractError(e.message));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this story?")) return;
    await deleteStory(id);
    setStories(ss => ss.filter(s => s.id !== id));
  }

  async function handlePolish(id: string) {
    setPolishingId(id);
    setError("");
    try {
      const updated = await polishStory(id, provider, apiKey || undefined);
      setStories(ss => ss.map(s => s.id === id ? updated : s));
    } catch (e: any) {
      setError(extractError(e.message));
    } finally {
      setPolishingId(null);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      const newStories = await generateStories(provider, apiKey || undefined);
      setStories(ss => [...ss, ...newStories]);
    } catch (e: any) {
      setError(extractError(e.message));
    } finally {
      setGenerating(false);
    }
  }

  function setField(k: keyof Story, v: any) {
    setEditing(e => e ? { ...e, [k]: v } : e);
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={backBtn}>← Back</button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1e293b" }}>
          📚 STAR Story Bank
        </h2>
        <span style={{ fontSize: 13, color: "#64748b", marginLeft: 4 }}>
          ({stories.length} stories)
        </span>
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#dc2626", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Category filter chips */}
      {stories.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          <button
            onClick={() => setFilterCategory("")}
            style={{ ...chipBtn, ...(filterCategory === "" ? chipActive : {}) }}
          >
            All ({stories.length})
          </button>
          {CATEGORIES.filter(c => stories.some(s => s.category === c)).map(c => {
            const clr = CATEGORY_COLORS[c] || CATEGORY_COLORS["Technical Achievement"];
            const count = stories.filter(s => s.category === c).length;
            const active = filterCategory === c;
            return (
              <button
                key={c}
                onClick={() => setFilterCategory(active ? "" : c)}
                style={{
                  padding: "3px 10px", fontSize: 11, borderRadius: 12, cursor: "pointer", fontWeight: 600,
                  background: active ? clr.color : clr.bg,
                  color: active ? "#fff" : clr.color,
                  border: `1px solid ${clr.border}`,
                }}
              >
                {c} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Action bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={startNew} style={primaryBtn}>+ New Story</button>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <select
            value={provider}
            onChange={e => setProvider(e.target.value)}
            style={selectStyle}
          >
            <option value="nvidia">NVIDIA NIM · Auto</option>
            <option value="anthropic">Claude Opus 4.7</option>
            <option value="openai">GPT-4o</option>
            <option value="gemini">Gemini 1.5 Pro</option>
          </select>
          {provider !== "nvidia" ? (
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Your API key"
              style={{ ...inputStyle, width: 260, marginBottom: 0 }}
            />
          ) : (
            <span style={{ fontSize: 12, color: "#16a34a", padding: "6px 10px", background: "#f0fdf4", borderRadius: 5, border: "1px solid #bbf7d0" }}>
              ✓ Built-in — no key needed
            </span>
          )}
          <button onClick={handleGenerate} disabled={generating} style={aiBtn}>
            {generating ? "Generating…" : "✨ AI Generate from Resume"}
          </button>
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "#1e293b" }}>
            {editId ? "Edit Story" : "New Story"}
          </h3>
          <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label style={labelStyle}>Title *</label>
              <input
                value={editing.title || ""}
                onChange={e => setField("title", e.target.value)}
                placeholder="e.g. Led wildfire risk modeling project"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle}>Category</label>
              <select
                value={editing.category || ""}
                onChange={e => setField("category", e.target.value)}
                style={{ ...inputStyle, background: "#fff" }}
              >
                <option value="">— Select —</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          {(["situation", "task", "action", "result"] as const).map(field => (
            <div key={field}>
              <label style={labelStyle}>
                {field.charAt(0).toUpperCase() + field.slice(1)}
                <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                  {field === "situation" && "(What was the context?)"}
                  {field === "task" && "(What was your responsibility?)"}
                  {field === "action" && "(What did you do?)"}
                  {field === "result" && "(What was the outcome? Add numbers!)"}
                </span>
              </label>
              <textarea
                value={(editing[field] as string) || ""}
                onChange={e => setField(field, e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", marginBottom: 12 }}
              />
            </div>
          ))}
          <div>
            <label style={labelStyle}>
              Reflection
              <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>(What did you learn? What would you do differently?)</span>
            </label>
            <textarea
              value={(editing.reflection as string) || ""}
              onChange={e => setField("reflection", e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "vertical", marginBottom: 12, background: "#fffbeb" }}
            />
          </div>
          <label style={labelStyle}>
            Skills / Tags
            <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>(comma-separated)</span>
          </label>
          <input
            value={(editing.skills || []).join(", ")}
            onChange={e => setField("skills", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
            placeholder="e.g. Python, GIS, stakeholder communication"
            style={{ ...inputStyle, marginBottom: 16 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={save} disabled={saving || !editing.title?.trim()} style={primaryBtn}>
              {saving ? "Saving…" : "Save Story"}
            </button>
            <button onClick={() => { setEditing(null); setEditId(null); }} style={cancelBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Story list */}
      {(() => {
        const visible = filterCategory ? stories.filter(s => s.category === filterCategory) : stories;
        if (stories.length === 0 && !editing) return (
          <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📖</div>
            <div style={{ fontSize: 14 }}>No stories yet.</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Add one manually or click "AI Generate from Resume".</div>
          </div>
        );
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {visible.map(s => (
              <StoryCard
                key={s.id}
                story={s}
                polishing={polishingId === s.id}
                onEdit={() => startEdit(s)}
                onDelete={() => remove(s.id)}
                onPolish={() => handlePolish(s.id)}
              />
            ))}
            {visible.length === 0 && filterCategory && (
              <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>
                No stories in "{filterCategory}" yet.
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function StoryCard({ story, polishing, onEdit, onDelete, onPolish }: {
  story: Story;
  polishing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPolish: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#1e293b" }}>{story.title}</span>
            {story.category && (() => {
              const clr = CATEGORY_COLORS[story.category] || CATEGORY_COLORS["Technical Achievement"];
              return (
                <span style={{ fontSize: 11, background: clr.bg, color: clr.color, border: `1px solid ${clr.border}`, borderRadius: 10, padding: "1px 8px", fontWeight: 600 }}>
                  {story.category}
                </span>
              );
            })()}
            {story.ai_polished && (
              <span style={{ fontSize: 11, background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0", borderRadius: 10, padding: "1px 8px" }}>
                ✨ AI polished
              </span>
            )}
            {story.linked_job_ids?.length > 0 && (
              <span style={{ fontSize: 11, background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 10, padding: "1px 8px" }}>
                🔗 {story.linked_job_ids.length} job{story.linked_job_ids.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {story.skills?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {story.skills.map(sk => (
                <span key={sk} style={{ fontSize: 11, background: "#f1f5f9", color: "#475569", borderRadius: 10, padding: "2px 8px" }}>{sk}</span>
              ))}
            </div>
          )}
          {expanded && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {(["situation", "task", "action", "result"] as const).map(field => story[field] ? (
                <div key={field}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{field}</span>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#334155", lineHeight: 1.6 }}>{story[field]}</p>
                </div>
              ) : null)}
              {story.reflection && (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "8px 12px" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.5 }}>Reflection</span>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#78350f", lineHeight: 1.6 }}>{story.reflection}</p>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={() => setExpanded(e => !e)} style={smallBtn}>{expanded ? "▲" : "▼"}</button>
          <button onClick={onPolish} disabled={polishing} style={aiSmallBtn}>
            {polishing ? "…" : "✨"}
          </button>
          <button onClick={onEdit} style={smallBtn}>Edit</button>
          <button onClick={onDelete} style={dangerSmallBtn}>Delete</button>
        </div>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "16px 18px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 4,
};

const selectStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px", background: "#2563eb", color: "#fff",
  border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
};

const aiBtn: React.CSSProperties = {
  ...primaryBtn, background: "#7c3aed",
};

const cancelBtn: React.CSSProperties = {
  ...primaryBtn, background: "#f1f5f9", color: "#334155",
  border: "1px solid #e2e8f0",
};

const backBtn: React.CSSProperties = {
  padding: "6px 14px", background: "#f1f5f9", color: "#334155",
  border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
};

const smallBtn: React.CSSProperties = {
  padding: "4px 10px", fontSize: 12, background: "#f8fafc", color: "#475569",
  border: "1px solid #e2e8f0", borderRadius: 5, cursor: "pointer",
};

const aiSmallBtn: React.CSSProperties = {
  ...smallBtn, background: "#faf5ff", color: "#7c3aed", border: "1px solid #e9d5ff",
};

const dangerSmallBtn: React.CSSProperties = {
  ...smallBtn, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca",
};

const chipBtn: React.CSSProperties = {
  padding: "3px 10px", fontSize: 11, borderRadius: 12, cursor: "pointer",
  background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", fontWeight: 500,
};

const chipActive: React.CSSProperties = {
  background: "#1e293b", color: "#fff", border: "1px solid #1e293b",
};
