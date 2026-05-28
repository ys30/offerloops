import { useState } from "react";
import { createJob, extractJobFromUrl } from "../api";

interface Props {
  onCreated: () => void;
  onClose: () => void;
}

export default function AddJobForm({ onCreated, onClose }: Props) {
  const [form, setForm] = useState({
    title: "",
    company: "",
    location_city: "",
    location_state: "",
    location_remote: false,
    description: "",
    apply_url: "",
    salary_min: "",
    salary_max: "",
    tags: "",
    deadline: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [extractUrl, setExtractUrl] = useState("");
  const [extracting, setExtracting] = useState(false);

  function set(key: string, value: unknown) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleExtract() {
    if (!extractUrl.trim()) return;
    setExtracting(true);
    setError("");
    try {
      const provider = localStorage.getItem("ol_ai_provider") || "nvidia";
      const apiKey = localStorage.getItem("ol_ai_key") || undefined;
      const data = await extractJobFromUrl(extractUrl.trim(), provider, apiKey);
      setForm(f => ({
        ...f,
        title: (data.title as string) || f.title,
        company: (data.company as string) || f.company,
        location_city: (data.location_city as string) || f.location_city,
        location_state: (data.location_state as string) || f.location_state,
        location_remote: (data.location_remote as boolean) ?? f.location_remote,
        description: (data.description as string) || f.description,
        apply_url: (data.apply_url as string) || extractUrl.trim(),
        salary_min: data.salary_min != null ? String(data.salary_min) : f.salary_min,
        salary_max: data.salary_max != null ? String(data.salary_max) : f.salary_max,
        tags: Array.isArray(data.tags) ? (data.tags as string[]).join(", ") : f.tags,
      }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createJob({
        ...form,
        salary_min: form.salary_min ? Number(form.salary_min) : undefined,
        salary_max: form.salary_max ? Number(form.salary_max) : undefined,
        tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        deadline: form.deadline || undefined,
      });
      onCreated();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Add Job Posting</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#888" }}>×</button>
        </div>

        {/* URL extraction */}
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0369a1", marginBottom: 8 }}>🔗 Extract from Job URL</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="url"
              value={extractUrl}
              onChange={e => setExtractUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && (e.preventDefault(), handleExtract())}
              placeholder="https://jobs.lever.co/company/job-id or any job posting URL…"
              style={{ ...inp, flex: 1 }}
            />
            <button
              type="button"
              onClick={handleExtract}
              disabled={extracting || !extractUrl.trim()}
              style={{ ...primaryBtn, background: "#0284c7", whiteSpace: "nowrap" }}
            >
              {extracting ? "Extracting…" : "✨ Extract"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#0369a1", marginTop: 6 }}>
            Paste any job posting link — AI fills the form automatically. Review and edit before saving.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Row>
            <Field label="Job Title *">
              <input required style={inp} value={form.title} onChange={e => set("title", e.target.value)} placeholder="Environmental Data Scientist" />
            </Field>
            <Field label="Company *">
              <input required style={inp} value={form.company} onChange={e => set("company", e.target.value)} placeholder="US EPA" />
            </Field>
          </Row>

          <Row>
            <Field label="City">
              <input style={inp} value={form.location_city} onChange={e => set("location_city", e.target.value)} placeholder="Washington" />
            </Field>
            <Field label="State">
              <input style={inp} value={form.location_state} onChange={e => set("location_state", e.target.value)} placeholder="DC" />
            </Field>
          </Row>

          <label style={checkboxLabel}>
            <input type="checkbox" checked={form.location_remote} onChange={e => set("location_remote", e.target.checked)} />
            &nbsp;Remote position
          </label>

          <Row>
            <Field label="Salary Min ($/yr)">
              <input style={inp} type="number" value={form.salary_min} onChange={e => set("salary_min", e.target.value)} placeholder="80000" />
            </Field>
            <Field label="Salary Max ($/yr)">
              <input style={inp} type="number" value={form.salary_max} onChange={e => set("salary_max", e.target.value)} placeholder="120000" />
            </Field>
          </Row>

          <Field label="Apply URL">
            <input style={inp} type="url" value={form.apply_url} onChange={e => set("apply_url", e.target.value)} placeholder="https://..." />
          </Field>

          <Field label="Deadline">
            <input style={inp} type="date" value={form.deadline} onChange={e => set("deadline", e.target.value)} />
          </Field>

          <Field label="Tags (comma-separated)">
            <input style={inp} value={form.tags} onChange={e => set("tags", e.target.value)} placeholder="python, GIS, water quality" />
          </Field>

          <Field label="Job Description *">
            <textarea
              required
              style={{ ...inp, resize: "vertical", fontFamily: "inherit", minHeight: 120 }}
              value={form.description}
              onChange={e => set("description", e.target.value)}
              placeholder="Paste the full job description here…"
            />
          </Field>

          {error && <div style={{ color: "#dc2626", fontSize: 12 }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} style={secondaryBtn}>Cancel</button>
            <button type="submit" disabled={saving} style={primaryBtn}>
              {saving ? "Saving…" : "Add Job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600, color: "#374151" }}>
      {label}
      {children}
    </label>
  );
}

const inp: React.CSSProperties = {
  padding: "7px 10px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
};

const checkboxLabel: React.CSSProperties = {
  fontSize: 13,
  color: "#374151",
  display: "flex",
  alignItems: "center",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  width: "100%",
  maxWidth: 600,
  maxHeight: "90vh",
  overflowY: "auto",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 20px",
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
};
