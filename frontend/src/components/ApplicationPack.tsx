interface ResumeData {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  headline?: string;
  core_expertise?: string;
  summary?: string;
  experience?: { title: string; company: string; dates: string; location?: string; bullets: string[] }[];
  education?: { degree: string; school: string; year: string; notes?: string }[];
  skills?: string[] | Record<string, string[]>;
  projects?: { name: string; description: string }[];
  publications?: string[];
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
  const name = (data.headline || data.name || "Your Name").toUpperCase();
  const contact = [data.location, data.phone, data.email, data.github].filter(Boolean).join(" | ");

  const sec = (title: string, content: string) =>
    `<div class="section"><div class="sec-head">${title}</div>${content}</div>`;

  const expHTML = (data.experience || []).map(e => `
    <div class="exp-block">
      <div class="exp-row">
        <strong>${e.company} - ${e.title}</strong>
        <span class="meta">${e.dates}${e.location ? " | " + e.location : ""}</span>
      </div>
      <ul>${(e.bullets || []).map(b => `<li>${b}</li>`).join("")}</ul>
    </div>`).join("");

  const eduHTML = (data.education || []).map(e =>
    `<div class="edu-row"><span>${e.degree} - ${e.school}</span></div>`
  ).join("");

  const skillsHTML = (() => {
    const s = data.skills;
    if (!s) return "";
    if (Array.isArray(s)) return `<p>${s.join(" · ")}</p>`;
    return Object.entries(s as Record<string, string[]>)
      .map(([g, items]) => `<div class="skill-line"><strong>${g}:</strong> ${items.join(", ")}</div>`)
      .join("");
  })();

  const projectsHTML = (data.projects || []).filter(p => p?.name?.trim() && p?.description?.trim()).map(p =>
    `<div class="exp-block"><strong>${p.name}</strong><ul><li>${p.description}</li></ul></div>`
  ).join("");

  const pubsHTML = (data.publications || []).filter(Boolean).map(p =>
    `<div class="pub-row">${p}</div>`
  ).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${data.name || "Resume"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; background: #fff;
         padding: 28px 38px; max-width: 780px; margin: 0 auto; font-size: 10.5px; line-height: 1.35; }
  .name { font-size: 13.5px; font-weight: 700; letter-spacing: 0.5px; text-align: center; margin-bottom: 1px; }
  .contact { text-align: center; color: #444; font-size: 9.5px; margin-bottom: 7px; }
  .section { margin-bottom: 6px; }
  .sec-head { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
              color: #1a6fa8; border-bottom: 1px solid #1a6fa8; padding-bottom: 1px; margin-bottom: 4px; }
  .expertise { font-size: 10px; color: #222; line-height: 1.4; }
  .summary-text { font-size: 10.5px; color: #222; line-height: 1.4; }
  .exp-block { margin-bottom: 5px; }
  .exp-row { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; }
  .exp-row strong { font-size: 10.5px; color: #111; }
  .meta { font-size: 9.5px; color: #555; white-space: nowrap; }
  ul { padding-left: 12px; margin-top: 1px; }
  li { margin-bottom: 0; font-size: 10px; color: #222; line-height: 1.35; }
  .edu-row { font-size: 10px; margin-bottom: 1px; }
  .skill-line { font-size: 10px; margin-bottom: 1px; }
  .skill-line strong { color: #111; }
  .pub-row { font-size: 10px; margin-bottom: 2px; color: #222; }
  @media print {
    body { padding: 0; font-size: 10px; }
    @page { margin: 0.35in 0.4in; size: letter; }
  }
</style>
</head>
<body>
  <div class="name">${name}</div>
  <div class="contact">${contact}</div>
  ${data.summary ? sec("PROFILE", `<div class="summary-text">${data.summary}</div>`) : ""}
  ${data.core_expertise ? sec("CORE EXPERTISE", `<div class="expertise">${data.core_expertise}</div>`) : ""}
  ${expHTML ? sec("PROFESSIONAL EXPERIENCE", expHTML) : ""}
  ${projectsHTML ? sec("SELECTED PROJECTS", projectsHTML) : ""}
  ${pubsHTML ? sec("SELECTED PUBLICATIONS", pubsHTML) : ""}
  ${skillsHTML ? sec("TECHNICAL SKILLS", skillsHTML) : ""}
  ${eduHTML ? sec("EDUCATION", eduHTML) : ""}
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
            : result.cover_letter?.trim()
              ? <div style={{ whiteSpace: "pre-wrap" }}>{result.cover_letter}</div>
              : <div style={{ color: "#94a3b8", fontStyle: "italic", textAlign: "center", padding: "32px 0" }}>
                  Cover letter could not be generated.<br />
                  <span style={{ fontSize: 12 }}>Make sure your resume is saved in Profile, then try again.</span>
                </div>
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
    return <div style={{ whiteSpace: "pre-wrap", fontSize: 11, fontFamily: "monospace" }}>{fallback}</div>;
  }
  const contact = [data.location, data.phone, data.email, data.github].filter(Boolean).join(" | ");
  const headlineName = (data.headline || data.name || "").toUpperCase();
  return (
    <div style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: 11.5, lineHeight: 1.45, color: "#111" }}>
      {headlineName && <div style={{ fontSize: 14, fontWeight: 700, textAlign: "center", marginBottom: 2, letterSpacing: 0.5 }}>{headlineName}</div>}
      {contact && <div style={{ fontSize: 10.5, color: "#444", textAlign: "center", marginBottom: 10 }}>{contact}</div>}

      {data.summary && <>
        <SectionHead>PROFILE</SectionHead>
        <div style={{ fontSize: 11.5, color: "#222", marginBottom: 6 }}>{data.summary}</div>
      </>}

      {data.core_expertise && <>
        <SectionHead>CORE EXPERTISE</SectionHead>
        <div style={{ fontSize: 11, color: "#222", marginBottom: 6 }}>{data.core_expertise}</div>
      </>}

      {data.experience?.length ? <>
        <SectionHead>PROFESSIONAL EXPERIENCE</SectionHead>
        {data.experience.map((e, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 11.5 }}>{e.company} - {e.title}</strong>
              <span style={{ fontSize: 10.5, color: "#555" }}>{e.dates}{e.location ? " | " + e.location : ""}</span>
            </div>
            <ul style={{ paddingLeft: 14, margin: "2px 0 0" }}>
              {(e.bullets || []).map((b, j) => <li key={j} style={{ fontSize: 11, marginBottom: 1, lineHeight: 1.4 }}>{b}</li>)}
            </ul>
          </div>
        ))}
      </> : null}

      {data.projects?.filter(p => p?.name?.trim() && p?.description?.trim()).length ? <>
        <SectionHead>SELECTED PROJECTS</SectionHead>
        {data.projects.filter(p => p?.name?.trim() && p?.description?.trim()).map((p, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: 11.5 }}>{p.name}</strong>
            <ul style={{ paddingLeft: 14, margin: "2px 0 0" }}>
              <li style={{ fontSize: 11, lineHeight: 1.4 }}>{p.description}</li>
            </ul>
          </div>
        ))}
      </> : null}

      {data.publications?.filter(Boolean).length ? <>
        <SectionHead>SELECTED PUBLICATIONS</SectionHead>
        {data.publications.filter(Boolean).map((p, i) => (
          <div key={i} style={{ fontSize: 11, marginBottom: 3, lineHeight: 1.4, color: "#222" }}>{p}</div>
        ))}
      </> : null}

      {data.skills && (Array.isArray(data.skills) ? data.skills.length > 0 : Object.keys(data.skills).length > 0) ? <>
        <SectionHead>TECHNICAL SKILLS</SectionHead>
        {Array.isArray(data.skills)
          ? <div style={{ fontSize: 11 }}>{data.skills.join(" · ")}</div>
          : Object.entries(data.skills as Record<string, string[]>).map(([group, items], gi) => (
              <div key={gi} style={{ fontSize: 11, marginBottom: 2 }}>
                <strong>{group}:</strong> {items.join(", ")}
              </div>
            ))
        }
      </> : null}

      {data.education?.length ? <>
        <SectionHead>EDUCATION</SectionHead>
        {data.education.map((e, i) => (
          <div key={i} style={{ fontSize: 11, marginBottom: 2 }}>
            <strong>{e.degree}</strong> - {e.school}
          </div>
        ))}
      </> : null}

      {data.ats_keywords?.length ? <>
        <SectionHead>ATS KEYWORDS</SectionHead>
        <div style={{ fontSize: 10.5, color: "#1e40af" }}>{data.ats_keywords.join(" · ")}</div>
      </> : null}
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 1, fontWeight: 700,
      color: "#1a6fa8", borderBottom: "1px solid #1a6fa8", paddingBottom: 2, margin: "10px 0 5px" }}>
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
