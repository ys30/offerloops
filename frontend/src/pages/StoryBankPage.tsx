import { useEffect, useState } from "react";
import {
  fetchStories, createStory, updateStory, deleteStory,
  polishStory, generateStories, type Story,
} from "../api";

interface Props {
  onBack: () => void;
}

const EMPTY: Partial<Story> = {
  title: "", situation: "", task: "", action: "", result: "",
  skills: [], linked_job_ids: [], ai_polished: false,
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
      setError(e.message);
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
      const updated = await polishStory(id, provider);
      setStories(ss => ss.map(s => s.id === id ? updated : s));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPolishingId(null);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      const newStories = await generateStories(provider);
      setStories(ss => [...ss, ...newStories]);
    } catch (e: any) {
      setError(e.message);
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

      {/* Action bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={startNew} style={primaryBtn}>+ New Story</button>
        <select
          value={provider}
          onChange={e => setProvider(e.target.value)}
          style={selectStyle}
        >
          <option value="nvidia">NVIDIA NIM</option>
          <option value="anthropic">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
        </select>
        <button onClick={handleGenerate} disabled={generating} style={aiBtn}>
          {generating ? "Generating…" : "✨ AI Generate from Resume"}
        </button>
        <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 4 }}>
          AI reads your profile resume and creates draft STAR stories
        </span>
      </div>

      {/* Edit form */}
      {editing && (
        <div style={cardStyle}>
          <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "#1e293b" }}>
            {editId ? "Edit Story" : "New Story"}
          </h3>
          <label style={labelStyle}>Title *</label>
          <input
            value={editing.title || ""}
            onChange={e => setField("title", e.target.value)}
            placeholder="e.g. Led wildfire risk modeling project"
            style={{ ...inputStyle, marginBottom: 12 }}
          />
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
      {stories.length === 0 && !editing ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📖</div>
          <div style={{ fontSize: 14 }}>No stories yet.</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Add one manually or click "AI Generate from Resume".</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {stories.map(s => (
            <StoryCard
              key={s.id}
              story={s}
              polishing={polishingId === s.id}
              onEdit={() => startEdit(s)}
              onDelete={() => remove(s.id)}
              onPolish={() => handlePolish(s.id)}
            />
          ))}
        </div>
      )}
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
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {(["situation", "task", "action", "result"] as const).map(field => story[field] ? (
                <div key={field}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{field}</span>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#334155", lineHeight: 1.6 }}>{story[field]}</p>
                </div>
              ) : null)}
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
