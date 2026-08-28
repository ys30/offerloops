import { useCallback, useEffect, useRef, useState } from "react";
import { disconnectGmail, fetchGmailStatus, getToken, startGmailAuth, syncGmail, fetchProjects, createProject, updateProject, deleteProject, uploadProjectDoc, suggestProjectOutcome, type Project } from "../api";
import StoryBankPage from "./StoryBankPage";
import type { GmailStatus } from "../types";

interface EducationEntry {
  degree: string;
  school: string;
  year: string;
  notes: string;
}

interface Profile {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin_url?: string;
  github_url?: string;
  google_scholar_url?: string;
  orcid_url?: string;
  website_url?: string;
  twitter_url?: string;
  resume_text?: string;
  education_json?: string;
  updated_at?: string;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}`, ...extra } : { ...extra };
}

async function fetchProfile(): Promise<Profile | null> {
  const res = await fetch("/api/profile", { headers: authHeaders() });
  if (res.status === 404) return null;
  return res.json();
}

async function saveProfile(data: Partial<Profile>): Promise<Profile> {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function uploadResume(file: File): Promise<Profile> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/profile/upload", { method: "POST", headers: authHeaders(), body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function importLinkedIn(url: string): Promise<Profile> {
  const res = await fetch(`/api/profile/linkedin?url=${encodeURIComponent(url)}`, { method: "POST", headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    try { throw new Error(JSON.parse(body).detail); } catch { throw new Error(body); }
  }
  return res.json();
}

export default function ProfilePage({ onBack, justConnectedGmail, gmailError }: { onBack: () => void; justConnectedGmail?: boolean; gmailError?: string | null }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editResume, setEditResume] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [scholarUrl, setScholarUrl] = useState("");
  const [orcidUrl, setOrcidUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [twitterUrl, setTwitterUrl] = useState("");
  const [linkedinPasteText, setLinkedinPasteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ scanned: number; new_events: number; jobs_updated: number } | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [editingProject, setEditingProject] = useState<Partial<Project> | null>(null);
  const [editProjectId, setEditProjectId] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [aiProvider, setAiProvider] = useState(() => localStorage.getItem("ol_ai_provider") || "nvidia");
  const [aiKey, setAiKey] = useState(() => localStorage.getItem("ol_ai_key") || "");
  const [projectFormError, setProjectFormError] = useState("");
  const [suggestingOutcome, setSuggestingOutcome] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const projectFileRef = useRef<HTMLInputElement>(null);
  const projectNameRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "stories">("profile");
  const [education, setEducation] = useState<EducationEntry[]>([]);

  useEffect(() => {
    fetchGmailStatus().then(setGmailStatus).catch(() => null);
  }, []);

  useEffect(() => {
    if (gmailError) flash(`Gmail connection failed: ${gmailError}`, false);
  }, [gmailError]);

  // If we just came back from Gmail OAuth, re-poll status after a short delay
  // to ensure the backend has committed the token
  useEffect(() => {
    if (!justConnectedGmail) return;
    const timer = setTimeout(() => {
      fetchGmailStatus().then(s => {
        setGmailStatus(s);
        if (s.connected) flash("Gmail connected successfully!");
      }).catch(() => null);
    }, 1500);
    return () => clearTimeout(timer);
  }, [justConnectedGmail]);

  useEffect(() => {
    fetchProfile().then(p => {
      setProfile(p);
      setEditResume(p?.resume_text || "");
      setLinkedinUrl(p?.linkedin_url || "");
      setGithubUrl(p?.github_url || "");
      setScholarUrl(p?.google_scholar_url || "");
      setOrcidUrl(p?.orcid_url || "");
      setWebsiteUrl(p?.website_url || "");
      setTwitterUrl(p?.twitter_url || "");
      try { setEducation(JSON.parse(p?.education_json || "[]")); } catch { setEducation([]); }
    });
    fetchProjects().then(setProjects).catch(() => null);
  }, []);

  const flash = (text: string, ok = true) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const p = await saveProfile({
        resume_text: editResume,
        linkedin_url: linkedinUrl || undefined,
        github_url: githubUrl || undefined,
        google_scholar_url: scholarUrl || undefined,
        orcid_url: orcidUrl || undefined,
        website_url: websiteUrl || undefined,
        twitter_url: twitterUrl || undefined,
        education_json: JSON.stringify(education),
      });
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

  const handleLinkedInPaste = async () => {
    if (!linkedinPasteText.trim()) return;
    setImporting(true);
    try {
      const res = await fetch("/api/profile/paste", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text: linkedinPasteText, linkedin_url: linkedinUrl || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? "Import failed");
      const p: Profile = await res.json();
      setProfile(p);
      setEditResume(p.resume_text || "");
      setLinkedinPasteText("");
      flash("Profile imported and formatted with AI.");
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : String(err), false);
    } finally {
      setImporting(false);
    }
  };

  const EMPTY_PROJECT: Partial<Project> = { name: "", description: "", role: "", tech_stack: [], outcome: "", url: "", dates: "" };

  const handleSaveProject = async () => {
    setProjectFormError("");
    if (!editingProject?.name?.trim()) {
      setProjectFormError("Project name is required.");
      projectNameRef.current?.focus();
      return;
    }
    setSavingProject(true);
    try {
      if (editProjectId) {
        const updated = await updateProject(editProjectId, editingProject as any);
        setProjects(ps => ps.map(p => p.id === editProjectId ? updated : p));
      } else {
        const created = await createProject(editingProject as any);
        setProjects(ps => [created, ...ps]);
      }
      setEditingProject(null);
      setEditProjectId(null);
      setProjectFormError("");
      flash("Project saved.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setProjectFormError(msg);
    } finally {
      setSavingProject(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm("Delete this project?")) return;
    await deleteProject(id);
    setProjects(ps => ps.filter(p => p.id !== id));
    flash("Project deleted.");
  };

  const setProjectField = (k: keyof Project, v: unknown) => {
    setEditingProject(p => p ? { ...p, [k]: v } : p);
  };

  const toggleSelectProject = (id: string) => {
    setSelectedProjects(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Delete ${selectedProjects.size} selected project(s)?`)) return;
    await Promise.all([...selectedProjects].map(id => deleteProject(id)));
    setProjects(ps => ps.filter(p => !selectedProjects.has(p.id)));
    setSelectedProjects(new Set());
    flash(`${selectedProjects.size} project(s) deleted.`);
  };

  const handleSuggestOutcome = async () => {
    if (!editingProject) return;
    setSuggestingOutcome(true);
    setProjectFormError("");
    try {
      const outcome = await suggestProjectOutcome(editingProject, aiProvider, aiKey || undefined);
      setProjectField("outcome", outcome);
    } catch (e: unknown) {
      setProjectFormError(e instanceof Error ? e.message : "AI suggestion failed");
    } finally {
      setSuggestingOutcome(false);
    }
  };

  const handleProjectDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);
    setUploadError("");
    try {
      const project = await uploadProjectDoc(file, aiProvider, aiKey || undefined);
      setProjects(ps => [project, ...ps]);
      setUploadError("");
      flash(`"${project.name}" extracted and added.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadError(msg);
    } finally {
      setUploadingDoc(false);
      if (projectFileRef.current) projectFileRef.current.value = "";
    }
  };

  const handleGmailConnect = () => {
    const token = getToken();
    if (!token) { flash("Sign in first to connect Gmail.", false); return; }
    startGmailAuth(token);
  };

  const handleGmailDisconnect = async () => {
    try {
      await disconnectGmail();
      setGmailStatus({ connected: false });
      setSyncResult(null);
      flash("Gmail disconnected.");
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : "Disconnect failed", false);
    }
  };

  const handleGmailSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncGmail(60);
      setSyncResult(result);
      setGmailStatus(prev => ({ ...prev!, connected: true, last_synced_at: new Date().toISOString() }));
      flash(`Sync done — ${result.new_events} new emails parsed, ${result.jobs_updated} jobs updated.`);
    } catch (e: unknown) {
      flash(e instanceof Error ? e.message : "Sync failed", false);
    } finally {
      setSyncing(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleUpload({ target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>);
  }, []);

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "10px 22px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    background: "none", border: "none", borderBottom: `2px solid ${active ? "#2563eb" : "transparent"}`,
    color: active ? "#2563eb" : "#64748b", marginBottom: -2,
  });

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "0 16px 80px" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "2px solid #e2e8f0", marginBottom: 24, marginTop: 8 }}>
        <button onClick={() => setActiveTab("profile")} style={tabBtn(activeTab === "profile")}>👤 Profile</button>
        <button onClick={() => setActiveTab("stories")} style={tabBtn(activeTab === "stories")}>📚 Stories</button>
      </div>

      {activeTab === "stories" ? (
        <StoryBankPage onBack={() => setActiveTab("profile")} />
      ) : (<>

      <h1 style={{ marginTop: 20, marginBottom: 4, fontSize: 22 }}>My Profile</h1>
      <p style={{ color: "#64748b", fontSize: 13, marginTop: 0, marginBottom: 24 }}>
        Your resume is stored here and used automatically for one-click application packs.
        {profile?.updated_at && ` Last updated: ${profile.updated_at.slice(0, 10)}`}
      </p>

      {/* AI Settings */}
      <section style={{ ...card, marginBottom: 16, background: "#faf5ff", border: "1px solid #e9d5ff" }}>
        <h2 style={{ ...sectionTitle, margin: "0 0 4px", color: "#6d28d9" }}>🤖 AI Settings</h2>
        <p style={{ fontSize: 12, color: "#7c3aed", margin: "0 0 14px" }}>
          Used for all AI features — job scoring, resume generation, story analysis, project extraction.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label style={{ ...lbl, color: "#6d28d9" }}>Provider</label>
            <select
              value={aiProvider}
              onChange={e => {
                setAiProvider(e.target.value);
                localStorage.setItem("ol_ai_provider", e.target.value);
                if (e.target.value === "nvidia") {
                  setAiKey("");
                  localStorage.removeItem("ol_ai_key");
                }
              }}
              style={{ padding: "8px 10px", border: "1px solid #d8b4fe", borderRadius: 6, fontSize: 13, background: "#fff", cursor: "pointer" }}
            >
              <option value="nvidia">NVIDIA NIM · Auto (no key needed)</option>
              <option value="anthropic">Claude Opus 4.7 (your key)</option>
              <option value="openai">GPT-4o (your key)</option>
              <option value="gemini">Gemini 1.5 Pro (your key)</option>
            </select>
          </div>
          {aiProvider !== "nvidia" && (
            <div style={{ flex: 1, minWidth: 240 }}>
              <label style={{ ...lbl, color: "#6d28d9" }}>API Key</label>
              <input
                type="password"
                value={aiKey}
                onChange={e => { setAiKey(e.target.value); localStorage.setItem("ol_ai_key", e.target.value); }}
                placeholder="Paste your API key here…"
                style={{ ...inp, borderColor: "#d8b4fe" }}
              />
            </div>
          )}
          <button
            onClick={() => {
              localStorage.setItem("ol_ai_key", aiKey);
              localStorage.setItem("ol_ai_provider", aiProvider);
              flash("AI settings saved.");
            }}
            style={{ ...primaryBtn, background: "#7c3aed", marginBottom: 1 }}
          >
            Save
          </button>
        </div>
        {aiProvider === "nvidia" ? (
          <div style={{ marginTop: 8, fontSize: 11, color: "#16a34a" }}>
            ✓ NVIDIA NIM (Nemotron Ultra 550B) — built-in, no key required
          </div>
        ) : aiKey && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#7c3aed" }}>
            ✓ Key saved — {aiProvider} · ends in …{aiKey.slice(-6)}
          </div>
        )}
      </section>

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

      {/* LinkedIn paste import */}
      <section style={{ ...card, marginTop: 16 }}>
        <h2 style={sectionTitle}>Import from LinkedIn</h2>
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 12px" }}>
          LinkedIn blocks automatic scraping. Instead, copy your profile text manually and paste it below — AI will format it into a clean resume.
        </p>
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 14px", marginBottom: 12, fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
          <strong>How to copy your LinkedIn profile:</strong><br />
          1. Open your LinkedIn profile in a browser<br />
          2. Select all text on the page (<kbd style={{ background: "#e2e8f0", borderRadius: 3, padding: "1px 5px" }}>Ctrl+A</kbd> or <kbd style={{ background: "#e2e8f0", borderRadius: 3, padding: "1px 5px" }}>Cmd+A</kbd>), then copy (<kbd style={{ background: "#e2e8f0", borderRadius: 3, padding: "1px 5px" }}>Ctrl+C</kbd>)<br />
          3. Paste into the box below and click "Format with AI"
        </div>
        <textarea
          style={{ ...inp, resize: "vertical", fontFamily: "inherit", fontSize: 12 }}
          rows={6}
          placeholder="Paste your LinkedIn profile text here…"
          value={linkedinPasteText}
          onChange={e => setLinkedinPasteText(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button onClick={handleLinkedInPaste} disabled={importing || !linkedinPasteText.trim()} style={primaryBtn}>
            {importing ? "Formatting…" : "✨ Format with AI"}
          </button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>AI cleans up the text into a structured resume</span>
        </div>
      </section>

      {/* Professional links */}
      <section style={{ ...card, marginTop: 16 }}>
        <h2 style={sectionTitle}>Professional Links</h2>
        <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 14px" }}>
          These are saved to your profile and help AI tailor your applications.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { label: "LinkedIn", icon: "🔗", value: linkedinUrl, set: setLinkedinUrl, placeholder: "https://linkedin.com/in/your-profile" },
            { label: "GitHub", icon: "🐙", value: githubUrl, set: setGithubUrl, placeholder: "https://github.com/username" },
            { label: "Google Scholar", icon: "🎓", value: scholarUrl, set: setScholarUrl, placeholder: "https://scholar.google.com/citations?user=..." },
            { label: "ORCID", icon: "🆔", value: orcidUrl, set: setOrcidUrl, placeholder: "https://orcid.org/0000-0000-0000-0000" },
            { label: "Personal Website", icon: "🌐", value: websiteUrl, set: setWebsiteUrl, placeholder: "https://yoursite.com" },
            { label: "Twitter / X", icon: "𝕏", value: twitterUrl, set: setTwitterUrl, placeholder: "https://twitter.com/username" },
          ].map(({ label, icon, value, set, placeholder }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, width: 24, flexShrink: 0 }}>{icon}</span>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", width: 120, flexShrink: 0 }}>{label}</label>
              <input
                style={{ ...inp, flex: 1 }}
                placeholder={placeholder}
                value={value}
                onChange={e => set(e.target.value)}
              />
              {value && (
                <a href={value} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: "#2563eb", whiteSpace: "nowrap" }}>
                  Open ↗
                </a>
              )}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={handleSave} disabled={saving} style={primaryBtn}>
            {saving ? "Saving…" : "Save Links"}
          </button>
        </div>
      </section>

      {/* Gmail sync */}
      <section style={{ ...card, marginTop: 16 }}>
        <h2 style={sectionTitle}>Gmail — Auto Inbox Scan</h2>
        <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 14px" }}>
          Connect Gmail to automatically detect application emails and update your tracker. Only reads — never sends.
        </p>
        {gmailStatus?.connected ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>✓ Gmail connected</span>
              {gmailStatus.last_synced_at && (
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  Last sync: {new Date(gmailStatus.last_synced_at).toLocaleString()}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleGmailSync} disabled={syncing} style={primaryBtn}>
                {syncing ? "Scanning…" : "Sync Inbox (60 days)"}
              </button>
              <button onClick={handleGmailDisconnect} style={{ ...secondaryBtn, color: "#dc2626", borderColor: "#fecaca" }}>
                Disconnect
              </button>
            </div>
            {syncResult && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#64748b", background: "#f8fafc", borderRadius: 6, padding: "8px 12px" }}>
                Scanned {syncResult.scanned} emails → {syncResult.new_events} job emails found → {syncResult.jobs_updated} statuses updated
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={handleGmailConnect} style={{ ...primaryBtn, display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Connect Gmail
          </button>
          <button
            onClick={() => fetchGmailStatus().then(setGmailStatus).catch(() => null)}
            style={{ ...secondaryBtn, fontSize: 12, padding: "6px 12px" }}
          >
            ↻ Recheck
          </button>
          </div>
        )}
      </section>

      {/* Projects */}
      <section style={{ ...card, marginTop: 16 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <h2 style={{ ...sectionTitle, margin: 0 }}>Projects</h2>
            <p style={{ fontSize: 12, color: "#94a3b8", margin: "4px 0 0" }}>
              AI reads these when generating your resume, cover letter, and STAR stories.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {selectedProjects.size > 0 && (
              <button onClick={handleDeleteSelected}
                style={{ padding: "7px 14px", fontSize: 12, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
                Delete {selectedProjects.size} selected
              </button>
            )}
            <button onClick={() => { setEditProjectId(null); setEditingProject({ ...EMPTY_PROJECT }); setProjectFormError(""); setSelectedProjects(new Set()); setTimeout(() => { projectNameRef.current?.focus(); projectNameRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 50); }} style={{ ...primaryBtn, fontSize: 13 }}>
              + Add Manually
            </button>
          </div>
        </div>

        {/* Document upload zone */}
        <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 8, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 8 }}>
            📄 Upload Project Document
          </div>
          <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px", lineHeight: 1.6 }}>
            Upload a PDF, DOCX, or TXT file — AI will extract the project name, role, tech stack, and outcomes automatically.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={aiProvider} onChange={e => { setAiProvider(e.target.value); localStorage.setItem("ol_ai_provider", e.target.value); }}
              style={{ padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12, background: "#fff", cursor: "pointer" }}>
              <option value="nvidia">NVIDIA NIM · Auto</option>
              <option value="anthropic">Claude Opus 4.7</option>
              <option value="openai">GPT-4o</option>
              <option value="gemini">Gemini 1.5 Pro</option>
            </select>
            {aiProvider !== "nvidia" && (
              <input type="password" value={aiKey} onChange={e => { setAiKey(e.target.value); localStorage.setItem("ol_ai_key", e.target.value); }}
                placeholder="Your API key"
                style={{ padding: "6px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 12, width: 220, boxSizing: "border-box" }} />
            )}
            <button
              onClick={() => projectFileRef.current?.click()}
              disabled={uploadingDoc}
              style={{ ...primaryBtn, background: "#7c3aed", fontSize: 12 }}
            >
              {uploadingDoc ? "Extracting…" : "✨ Upload & Extract"}
            </button>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>PDF · DOCX · TXT</span>
          </div>
          <input ref={projectFileRef} type="file" accept=".pdf,.docx,.doc,.txt,.md"
            onChange={handleProjectDocUpload} style={{ display: "none" }} />
          {uploadError && (
            <div style={{ marginTop: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px", fontSize: 12, color: "#dc2626" }}>
              ⚠ {uploadError}
              {uploadError.includes("API key") || uploadError.includes("provider") ? (
                <div style={{ marginTop: 4, color: "#7f1d1d", fontSize: 11 }}>
                  Enter your API key in the field above, or configure one on the server.
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Edit / New form */}
        {editingProject && (
          <div style={{ background: "#fff", border: "2px solid #2563eb", borderRadius: 10, padding: "16px 18px", marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
              {editProjectId ? "Edit Project" : "New Project"}
            </h3>
            <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ flex: 2, minWidth: 180 }}>
                <label style={lbl}>Project Name *</label>
                <input
                  ref={projectNameRef}
                  value={editingProject.name || ""} onChange={e => setProjectField("name", e.target.value)}
                  placeholder="e.g. RCCDAS Climate Risk Dashboard"
                  style={{ ...inp, borderColor: (!editingProject.name?.trim() && projectFormError) ? "#dc2626" : undefined }} />
              </div>
              <div style={{ flex: 1, minWidth: 130 }}>
                <label style={lbl}>Dates</label>
                <input value={editingProject.dates || ""} onChange={e => setProjectField("dates", e.target.value)}
                  placeholder="e.g. 2022 – 2024" style={inp} />
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Your Role</label>
              <input value={editingProject.role || ""} onChange={e => setProjectField("role", e.target.value)}
                placeholder="e.g. Lead Data Scientist — designed pipeline and built Shiny dashboard" style={inp} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Description <span style={{ color: "#94a3b8", fontWeight: 400 }}>(what it does, what you built)</span></label>
              <textarea value={editingProject.description || ""} onChange={e => setProjectField("description", e.target.value)}
                rows={3} placeholder="Describe the project, its purpose, and what you specifically built or contributed…"
                style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Tech Stack <span style={{ color: "#94a3b8", fontWeight: 400 }}>(comma-separated)</span></label>
              <input value={(editingProject.tech_stack || []).join(", ")}
                onChange={e => setProjectField("tech_stack", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                placeholder="e.g. Python, R, ArcGIS, Shiny, PostgreSQL" style={inp} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ ...lbl, marginBottom: 0 }}>
                  Outcome / Impact
                  <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>(results, metrics, publications)</span>
                </label>
                <button
                  type="button"
                  onClick={handleSuggestOutcome}
                  disabled={suggestingOutcome}
                  style={{ padding: "3px 10px", fontSize: 11, background: "#faf5ff", color: "#7c3aed", border: "1px solid #e9d5ff", borderRadius: 5, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
                >
                  {suggestingOutcome ? "Generating…" : "✨ AI Suggest"}
                </button>
              </div>
              <textarea value={editingProject.outcome || ""} onChange={e => setProjectField("outcome", e.target.value)}
                rows={2} placeholder="e.g. Deployed to 3 federal agencies; cited in 2 peer-reviewed papers; reduced analysis time by 60%"
                style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} />
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                Click "AI Suggest" to auto-generate based on your project name, role, and description.
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>URL <span style={{ color: "#94a3b8", fontWeight: 400 }}>(GitHub, paper, demo)</span></label>
              <input value={editingProject.url || ""} onChange={e => setProjectField("url", e.target.value)}
                placeholder="https://github.com/..." style={inp} />
            </div>
            {projectFormError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#dc2626" }}>
                {projectFormError}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSaveProject} disabled={savingProject} style={primaryBtn}>
                {savingProject ? "Saving…" : editProjectId ? "Save Changes" : "Add Project"}
              </button>
              <button onClick={() => { setEditingProject(null); setEditProjectId(null); setProjectFormError(""); }} style={secondaryBtn}>Cancel</button>
            </div>
          </div>
        )}

        {/* Project cards */}
        {projects.length === 0 && !editingProject ? (
          <div style={{ textAlign: "center", padding: "28px 0", color: "#94a3b8", fontSize: 13 }}>
            No projects yet — upload a document or add one manually.
          </div>
        ) : (
          <>
            {projects.length > 1 && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
                Click a card to select it. {selectedProjects.size > 0 && <strong style={{ color: "#2563eb" }}>{selectedProjects.size} selected</strong>}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
              {projects.map(p => {
                const selected = selectedProjects.has(p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => toggleSelectProject(p.id)}
                    style={{
                      border: `2px solid ${selected ? "#2563eb" : "#e2e8f0"}`,
                      borderRadius: 10, padding: "14px 16px", background: selected ? "#eff6ff" : "#fff",
                      cursor: "pointer", transition: "all 0.15s", position: "relative",
                    }}
                  >
                    {/* Selection indicator */}
                    <div style={{
                      position: "absolute", top: 12, right: 12,
                      width: 18, height: 18, borderRadius: 4,
                      border: `2px solid ${selected ? "#2563eb" : "#cbd5e1"}`,
                      background: selected ? "#2563eb" : "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, color: "#fff", fontWeight: 700, flexShrink: 0,
                    }}>
                      {selected ? "✓" : ""}
                    </div>

                    <div style={{ paddingRight: 28 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#1e293b", lineHeight: 1.3 }}>{p.name}</div>
                      {p.dates && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{p.dates}</div>}
                      {p.role && <div style={{ fontSize: 12, color: "#475569", marginTop: 4, fontStyle: "italic" }}>{p.role}</div>}
                      {p.description && (
                        <div style={{ fontSize: 12, color: "#334155", marginTop: 6, lineHeight: 1.6,
                          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                          {p.description}
                        </div>
                      )}
                      {p.tech_stack?.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                          {p.tech_stack.slice(0, 6).map(t => (
                            <span key={t} style={{ fontSize: 10, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 3, padding: "1px 6px" }}>{t}</span>
                          ))}
                          {p.tech_stack.length > 6 && <span style={{ fontSize: 10, color: "#94a3b8" }}>+{p.tech_stack.length - 6}</span>}
                        </div>
                      )}
                      {p.outcome && (
                        <div style={{ fontSize: 11, color: "#15803d", marginTop: 6, background: "#f0fdf4", borderRadius: 5, padding: "4px 8px", lineHeight: 1.5 }}>
                          📈 {p.outcome}
                        </div>
                      )}
                    </div>

                    {/* Card actions */}
                    <div style={{ display: "flex", gap: 6, marginTop: 12, paddingTop: 10, borderTop: "1px solid #f1f5f9" }}
                      onClick={e => e.stopPropagation()}>
                      {p.url && (
                        <a href={p.url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: "#2563eb", padding: "3px 8px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, textDecoration: "none" }}>
                          🔗 Link
                        </a>
                      )}
                      <button onClick={() => { setEditProjectId(p.id); setEditingProject({ ...p }); setProjectFormError(""); setSelectedProjects(new Set()); setTimeout(() => { projectNameRef.current?.focus(); projectNameRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 50); }}
                        style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11, background: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 4, cursor: "pointer" }}>
                        Edit
                      </button>
                      <button onClick={() => handleDeleteProject(p.id)}
                        style={{ padding: "3px 10px", fontSize: 11, background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: 4, cursor: "pointer" }}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* Education entries — authoritative list for AI */}
      <section style={{ ...card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ ...sectionTitle, margin: 0 }}>Education</h2>
          <button
            onClick={() => setEducation(prev => [...prev, { degree: "", school: "", year: "", notes: "" }])}
            style={{ padding: "4px 12px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}
          >+ Add degree</button>
        </div>
        <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>
          These entries are injected directly into every resume generation — always included, never guessed.
        </p>
        {education.length === 0 && (
          <p style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>No education entries yet. Click "+ Add degree" to add your degrees.</p>
        )}
        {education.map((entry, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px auto", gap: 6, marginBottom: 8, alignItems: "start" }}>
            <input
              placeholder="Degree (e.g. Ph.D. in Ecology)"
              value={entry.degree}
              onChange={e => setEducation(prev => prev.map((x, j) => j === i ? { ...x, degree: e.target.value } : x))}
              style={{ ...inp, fontSize: 12 }}
            />
            <input
              placeholder="School (exact name)"
              value={entry.school}
              onChange={e => setEducation(prev => prev.map((x, j) => j === i ? { ...x, school: e.target.value } : x))}
              style={{ ...inp, fontSize: 12 }}
            />
            <input
              placeholder="Year"
              value={entry.year}
              onChange={e => setEducation(prev => prev.map((x, j) => j === i ? { ...x, year: e.target.value } : x))}
              style={{ ...inp, fontSize: 12 }}
            />
            <button
              onClick={() => setEducation(prev => prev.filter((_, j) => j !== i))}
              style={{ padding: "6px 10px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 5, cursor: "pointer", fontSize: 12 }}
            >✕</button>
          </div>
        ))}
        {education.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={handleSave} disabled={saving} style={primaryBtn}>
              {saving ? "Saving…" : "Save Education"}
            </button>
          </div>
        )}
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
      </>)}
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
const lbl: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4,
};
