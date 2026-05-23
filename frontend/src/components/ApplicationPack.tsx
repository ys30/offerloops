import { useState } from "react";

interface PackResult {
  job_title: string;
  company: string;
  tailored_resume: string;
  cover_letter: string;
  provider_used: string;
}

interface Props {
  result: PackResult;
  onClose: () => void;
}

type Tab = "resume" | "cover";

export default function ApplicationPack({ result, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("resume");

  function downloadText(content: string, filename: string) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPDF(content: string, title: string) {
    const slug = result.company.toLowerCase().replace(/\s+/g, "-");
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body { font-family: Georgia, serif; max-width: 780px; margin: 40px auto; padding: 0 24px; color: #1a202c; line-height: 1.6; font-size: 14px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 24px; }
  h3 { font-size: 14px; margin-bottom: 2px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 4px; }
  p { margin: 8px 0; }
  pre { white-space: pre-wrap; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<pre style="font-family:inherit;white-space:pre-wrap">${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>`;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  }

  const activeContent = tab === "resume" ? result.tailored_resume : result.cover_letter;
  const company = result.company;
  const titleSlug = result.job_title.toLowerCase().replace(/\s+/g, "-").slice(0, 30);

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Application Pack</h2>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {result.job_title} @ {company} · via {result.provider_used}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {(["resume", "cover"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "6px 16px",
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                cursor: "pointer",
                background: tab === t ? "#1e293b" : "#fff",
                color: tab === t ? "#fff" : "#374151",
              }}
            >
              {t === "resume" ? "Tailored Resume" : "Cover Letter"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: "16px 18px",
          maxHeight: "50vh",
          overflowY: "auto",
          fontFamily: "Georgia, serif",
          fontSize: 13,
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
          color: "#1a202c",
        }}>
          {activeContent}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            onClick={() => downloadText(activeContent, tab === "resume" ? `resume-${titleSlug}.md` : `cover-letter-${titleSlug}.txt`)}
            style={secondaryBtn}
          >
            Download .txt
          </button>
          <button
            onClick={() => downloadPDF(activeContent, tab === "resume" ? `Resume — ${result.job_title}` : `Cover Letter — ${result.job_title}`)}
            style={primaryBtn}
          >
            Download PDF
          </button>
          {tab === "resume" ? (
            <button onClick={() => setTab("cover")} style={secondaryBtn}>View Cover Letter →</button>
          ) : (
            <button onClick={() => setTab("resume")} style={secondaryBtn}>← View Resume</button>
          )}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 200,
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  width: "100%",
  maxWidth: 700,
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 18px",
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
  border: "1px solid #e2e8f0",
};
