import { useCallback, useEffect, useRef, useState } from "react";
import { disconnectGmail, fetchGmailStatus, getToken, startGmailAuth, syncGmail } from "../api";
import type { GmailStatus } from "../types";

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
    });
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
