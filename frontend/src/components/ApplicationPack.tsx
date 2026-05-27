interface ResumeData {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  summary?: string;
  experience?: { title: string; company: string; dates: string; bullets: string[] }[];
  education?: { degree: string; school: string; year: string; notes?: string }[];
  skills?: string[] | Record<string, string[]>;
  projects?: { name: string; description: string }[];
  ats_keywords?: string[];
}

interface PackResult {
  job_title: string;
  company: string;
  tailored_resume: ResumeData | string;
  cover_letter: string;
  provider_used: string;
}

interface Props {
  result: PackResult;
  onClose: () => void;
}

type Tab = "resume" | "cover";

function buildResumeHTML(data: ResumeData, jobTitle: string, company: string): string {
  const name = data.name || "Your Name";
  const contact = [data.email, data.phone, data.location, data.linkedin].filter(Boolean).join("  ·  ");

  const expHTML = (data.experience || []).map(e => `
    <div class="exp-item">
      <div class="exp-header">
        <span class="exp-title">${e.title}</span>
        <span class="exp-dates">${e.dates}</span>
      </div>
      <div class="exp-company">${e.company}</div>
      <ul>${(e.bullets || []).map(b => `<li>${b}</li>`).join("")}</ul>
    </div>`).join("");

  const eduHTML = (data.education || []).map(e => `
    <div class="edu-item">
      <span class="exp-title">${e.degree}</span> — ${e.school}
      <span class="exp-dates">${e.year}</span>
      ${e.notes ? `<div style="font-size:12px;color:#555">${e.notes}</div>` : ""}
    </div>`).join("");

  const skillsHTML = (() => {
    const s = data.skills;
    if (!s || (Array.isArray(s) && !s.length)) return "";
    if (Array.isArray(s)) {
      return `<div class="skills-list">${s.map(x => `<span class="skill-tag">${x}</span>`).join("")}</div>`;
    }
    return Object.entries(s).map(([group, items]) =>
      `<div class="skill-group"><strong style="font-size:12px;color:#444">${group}:</strong> ${items.map(x => `<span class="skill-tag">${x}</span>`).join("")}</div>`
    ).join("");
  })();

  const projectsHTML = (data.projects || []).length
    ? (data.projects || []).map(p => `
    <div class="exp-item">
      <div class="exp-title">${p.name}</div>
      <div style="font-size:12.5px;color:#333;margin-top:3px">${p.description}</div>
    </div>`).join("")
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Resume — ${name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Georgia', serif; color: #1a1a1a; background: #fff; padding: 48px 56px; max-width: 820px; margin: 0 auto; font-size: 13.5px; line-height: 1.6; }
  h1 { font-size: 26px; letter-spacing: -0.5px; font-weight: 700; margin-bottom: 4px; }
  .contact { color: #555; font-size: 12px; margin-bottom: 20px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1.5px; color: #444; border-bottom: 1.5px solid #222; padding-bottom: 4px; margin: 22px 0 12px; font-weight: 700; }
  .summary { color: #333; margin-bottom: 4px; }
  .exp-item { margin-bottom: 16px; }
  .exp-header { display: flex; justify-content: space-between; align-items: baseline; }
  .exp-title { font-weight: 700; font-size: 14px; }
  .exp-dates { color: #666; font-size: 12px; }
  .exp-company { color: #555; font-size: 12.5px; margin-bottom: 6px; font-style: italic; }
  ul { padding-left: 18px; margin-top: 4px; }
  li { margin-bottom: 3px; color: #222; }
  .edu-item { margin-bottom: 8px; display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 4px; }
  .skills-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .skill-tag { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 2px 10px; font-size: 12px; color: #334155; }
  .skill-group { margin-bottom: 6px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .tailor-note { font-size: 11px; color: #94a3b8; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 8px; }
  @media print {
    body { padding: 24px 32px; }
    .tailor-note { display: none; }
    @page { margin: 0.6in; }
  }
</style>
</head>
<body>
  <h1>${name}</h1>
  <div class="contact">${contact}</div>
  ${data.summary ? `<h2>Summary</h2><p class="summary">${data.summary}</p>` : ""}
  ${expHTML ? `<h2>Experience</h2>${expHTML}` : ""}
  ${eduHTML ? `<h2>Education</h2>${eduHTML}` : ""}
  ${skillsHTML ? `<h2>Skills</h2>${skillsHTML}` : ""}
  ${projectsHTML ? `<h2>Projects</h2>${projectsHTML}` : ""}
  <p class="tailor-note">Tailored for: ${jobTitle} @ ${company}</p>
</body>
</html>`;
}

function buildCoverHTML(text: string, jobTitle: string, company: string, name?: string): string {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Cover Letter — ${jobTitle}</title>
<style>
  body { font-family: 'Georgia', serif; color: #1a1a1a; background: #fff; padding: 72px 80px; max-width: 760px; margin: 0 auto; font-size: 14px; line-height: 1.8; }
  .header { margin-bottom: 36px; }
  .name { font-size: 20px; font-weight: 700; }
  .to { margin: 28px 0 28px; color: #444; font-size: 13px; }
  p { margin-bottom: 18px; }
  .closing { margin-top: 32px; }
  @media print { body { padding: 36px 48px; } @page { margin: 0.75in; } }
</style>
</head>
<body>
  <div class="header"><div class="name">${name || ""}</div></div>
  <div class="to">Hiring Manager<br>${company}<br>Re: ${jobTitle}</div>
  ${paragraphs}
  <div class="closing">Sincerely,<br><br>${name || ""}</div>
</body>
</html>`;
}

export default function ApplicationPack({ result, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("resume");

  // Handle both structured JSON and fallback string resume
  const resumeData: ResumeData = typeof result.tailored_resume === "string"
    ? { summary: result.tailored_resume }
    : result.tailored_resume;

  const resumeDisplay = typeof result.tailored_resume === "string"
    ? result.tailored_resume
    : formatResumeText(resumeData);

  function openAndPrint(html: string) {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  function downloadText(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  const titleSlug = result.job_title.toLowerCase().replace(/\s+/g, "-").slice(0, 30);

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Application Pack — Ready to Submit</h2>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
              {result.job_title} @ {result.company}
              <span style={{ marginLeft: 8, background: "#f1f5f9", padding: "1px 7px", borderRadius: 4, fontSize: 11 }}>
                {result.provider_used}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {(["resume", "cover"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "7px 18px", fontSize: 13, fontWeight: 600,
              border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer",
              background: tab === t ? "#1e293b" : "#fff",
              color: tab === t ? "#fff" : "#374151",
            }}>
              {t === "resume" ? "📄 Tailored Resume" : "✉️ Cover Letter"}
            </button>
          ))}
        </div>

        {/* Preview */}
        <div style={{
          background: "#fafafa", border: "1px solid #e2e8f0", borderRadius: 8,
          padding: "16px 18px", maxHeight: "46vh", overflowY: "auto",
          fontFamily: "Georgia, serif", fontSize: 13, lineHeight: 1.7,
          color: "#1a202c",
        }}>
          {tab === "resume"
            ? <ResumePreview data={resumeData} fallback={resumeDisplay} />
            : <div style={{ whiteSpace: "pre-wrap" }}>{result.cover_letter}</div>
          }
        </div>

        {/* Download actions */}
        <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            onClick={() => downloadText(
              tab === "resume" ? resumeDisplay : result.cover_letter,
              tab === "resume" ? `resume-${titleSlug}.txt` : `cover-letter-${titleSlug}.txt`
            )}
            style={secondaryBtn}
          >
            Download .txt
          </button>
          <button
            onClick={() => {
              const html = tab === "resume"
                ? buildResumeHTML(resumeData, result.job_title, result.company)
                : buildCoverHTML(result.cover_letter, result.job_title, result.company, resumeData.name);
              openAndPrint(html);
            }}
            style={primaryBtn}
          >
            🖨 Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function ResumePreview({ data, fallback }: { data: ResumeData; fallback: string }) {
  if (!data.name && !data.experience?.length) {
    return <div style={{ whiteSpace: "pre-wrap", fontSize: 12, fontFamily: "monospace" }}>{fallback}</div>;
  }
  const contact = [data.email, data.phone, data.location].filter(Boolean).join(" · ");
  return (
    <div>
      {data.name && <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>{data.name}</div>}
      {contact && <div style={{ fontSize: 12, color: "#666", marginBottom: 14 }}>{contact}</div>}
      {data.summary && <><SectionHead>Summary</SectionHead><p>{data.summary}</p></>}
      {data.experience?.length ? (
        <><SectionHead>Experience</SectionHead>
        {data.experience.map((e, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <strong>{e.title}</strong><span style={{ fontSize: 11, color: "#666" }}>{e.dates}</span>
            </div>
            <div style={{ fontStyle: "italic", fontSize: 12, color: "#555", marginBottom: 4 }}>{e.company}</div>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {(e.bullets || []).map((b, j) => <li key={j} style={{ marginBottom: 2 }}>{b}</li>)}
            </ul>
          </div>
        ))}</>
      ) : null}
      {data.education?.length ? (
        <><SectionHead>Education</SectionHead>
        {data.education.map((e, i) => (
          <div key={i} style={{ marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
            <span><strong>{e.degree}</strong> — {e.school}</span>
            <span style={{ fontSize: 11, color: "#666" }}>{e.year}</span>
          </div>
        ))}</>
      ) : null}
      {data.skills && (Array.isArray(data.skills) ? data.skills.length > 0 : Object.keys(data.skills).length > 0) ? (
        <><SectionHead>Skills</SectionHead>
        {Array.isArray(data.skills)
          ? <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {data.skills.map((s, i) => (
                <span key={i} style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 8px", fontSize: 11 }}>{s}</span>
              ))}
            </div>
          : Object.entries(data.skills as Record<string, string[]>).map(([group, items], gi) => (
              <div key={gi} style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 5, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#444", minWidth: 120 }}>{group}:</span>
                {items.map((s, i) => (
                  <span key={i} style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 4, padding: "1px 8px", fontSize: 11 }}>{s}</span>
                ))}
              </div>
            ))
        }</>
      ) : null}
      {data.projects?.length ? (
        <><SectionHead>Projects</SectionHead>
        {data.projects.map((p, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>{p.name}</strong>
            <div style={{ fontSize: 12, color: "#333", marginTop: 2 }}>{p.description}</div>
          </div>
        ))}</>
      ) : null}
      {data.ats_keywords?.length ? (
        <><SectionHead>ATS Keywords</SectionHead>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {data.ats_keywords.map((k, i) => (
            <span key={i} style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 4, padding: "1px 8px", fontSize: 11, color: "#1e40af" }}>{k}</span>
          ))}
        </div></>
      ) : null}
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, color: "#444", borderBottom: "1.5px solid #222", paddingBottom: 3, margin: "16px 0 8px", fontWeight: 700 }}>
      {children}
    </div>
  );
}

function formatResumeText(data: ResumeData): string {
  const lines: string[] = [];
  if (data.name) lines.push(data.name);
  const contact = [data.email, data.phone, data.location].filter(Boolean).join(" · ");
  if (contact) lines.push(contact);
  if (data.summary) { lines.push("", "SUMMARY", data.summary); }
  if (data.experience?.length) {
    lines.push("", "EXPERIENCE");
    for (const e of data.experience) {
      lines.push(`${e.title} | ${e.company} | ${e.dates}`);
      for (const b of e.bullets || []) lines.push(`  • ${b}`);
    }
  }
  if (data.education?.length) {
    lines.push("", "EDUCATION");
    for (const e of data.education) lines.push(`${e.degree} — ${e.school} (${e.year})`);
  }
  if (data.skills) {
    if (Array.isArray(data.skills) && data.skills.length) {
      lines.push("", "SKILLS", data.skills.join(", "));
    } else if (!Array.isArray(data.skills)) {
      lines.push("", "SKILLS");
      for (const [group, items] of Object.entries(data.skills as Record<string, string[]>)) {
        lines.push(`${group}: ${items.join(", ")}`);
      }
    }
  }
  if (data.projects?.length) {
    lines.push("", "PROJECTS");
    for (const p of data.projects) lines.push(`${p.name}: ${p.description}`);
  }
  return lines.join("\n");
}

import { useState } from "react";

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 200, padding: 16,
};
const modalStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: 24,
  width: "100%", maxWidth: 720, maxHeight: "92vh", overflowY: "auto",
  boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 18px", background: "#2563eb", color: "#fff",
  border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const secondaryBtn: React.CSSProperties = {
  ...primaryBtn, background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0",
};
