import { useCallback, useEffect, useRef, useState } from "react";

interface Profile {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin_url?: string;
  resume_text?: string;
  updated_at?: string;
}

async function fetchProfile(): Promise<Profile | null> {
  const res = await fetch("/api/profile");
  if (res.status === 404) return null;
  return res.json();
}

async function saveProfile(data: Partial<Profile>): Promise<Profile> {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function uploadResume(file: File): Promise<Profile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/profile/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function importLinkedIn(url: string): Promise<Profile> {
  const res = await fetch(`/api/profile/linkedin?url=${encodeURIComponent(url)}`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function ProfilePage({ onBack }: { onBack: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editResume, setEditResume] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchProfile().then(p => {
      setProfile(p);
      setEditResume(p?.resume_text || "");
      setLinkedinUrl(p?.linkedin_url || "");
    });
  }, []);

  const flash = (text: string, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const p = await saveProfile({ resume_text: editResume, linkedin_url: linkedinUrl || undefined });
      setProfile(p);
      flash("Profile saved.");
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : String(e), false);
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const p = await uploadResume(file);
      setProfile(p);
      setEditResume(p.resume_text || "");
      flash(`Extracted ${p.resume_text?.length ?? 0} characters from ${file.name}`);
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : String(err), false);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleLinkedIn = async () => {
    if (!linkedinUrl.trim()) return;
    setImporting(true);
    try {
      const p = await importLinkedIn(linkedinUrl);
      setProfile(p);
      setEditResume(p.resume_text || "");
      flash("LinkedIn profile imported.");
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : String(err), false);
    } finally {
      setImporting(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleUpload({ target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>);
  }, []);

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "0 16px 80px" }}>
      <button onClick={onBack} style={secondaryBtn}>← Back to Jobs</button>

      <h1 style={{ marginTop: 20, marginBottom: 4, fontSize: 22 }}>My Profile</h1>
      <p style={{ color: "#64748b", fontSize: 13, marginTop: 0, marginBottom: 24 }}>
        Your resume is stored here and used automatically for one-click application packs.
        {profile?.updated_at && ` Last updated: ${profile.updated_at.slice(0, 10)}`}
      </p>

      {msg && (
        <div style={{
          padding: "10px 14px", borderRadius: 7, marginBottom: 16, fontSize: 13, fontWeight: 600,
          background: msg.ok ? "#f0fdf4" : "#fef2f2",
          color: msg.ok ? "#166534" : "#dc2626",
          border: `1px solid ${msg.ok ? "#bbf7d0" : "#fecaca"}`,
        }}>
          {msg.text}
        </div>
      )}

      {/* Upload zone */}
      <section style={card}>
        <h2 style={sectionTitle}>Upload Resume</h2>
        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          style={{
            border: "2px dashed #cbd5e1", borderRadius: 8, padding: "28px 20px",
            textAlign: "center", cursor: "pointer", background: "#f8fafc",
            transition: "border-color 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "#2563eb")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "#cbd5e1")}
        >
          <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
            {uploading ? "Extracting text…" : "Drop PDF, DOCX, or TXT here — or click to browse"}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Supports .pdf · .docx · .doc · .txt · .md</div>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.txt,.md" onChange={handleUpload} style={{ display: "none" }} />
      </section>

      {/* LinkedIn import */}
      <section style={{ ...card, marginTop: 16 }}>
        <h2 style={sectionTitle}>Import from LinkedIn</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inp, flex: 1 }}
            placeholder="https://www.linkedin.com/in/your-profile"
            value={linkedinUrl}
            onChange={e => setLinkedinUrl(e.target.value)}
          />
          <button onClick={handleLinkedIn} disabled={importing || !linkedinUrl.trim()} style={primaryBtn}>
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
        <p style={{ fontSize: 11, color: "#94a3b8", margin: "6px 0 0" }}>
          Note: If LinkedIn blocks scraping, export your data from LinkedIn Settings → Get a copy of your data, then upload the PDF above.
        </p>
      </section>

      {/* Resume text editor */}
      <section style={{ ...card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ ...sectionTitle, margin: 0 }}>Resume Text</h2>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{editResume.length} characters</span>
        </div>
        <textarea
          value={editResume}
          onChange={e => setEditResume(e.target.value)}
          placeholder="Paste your resume here, or upload a file above…"
          rows={16}
          style={{ ...inp, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
        />
        <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={handleSave} disabled={saving} style={primaryBtn}>
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </section>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px",
};
const sectionTitle: React.CSSProperties = {
  fontSize: 15, fontWeight: 700, color: "#1a202c", margin: "0 0 12px",
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1",
  borderRadius: 6, fontSize: 13, boxSizing: "border-box",
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 18px", background: "#2563eb", color: "#fff",
  border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const secondaryBtn: React.CSSProperties = {
  ...primaryBtn, background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0",
};
