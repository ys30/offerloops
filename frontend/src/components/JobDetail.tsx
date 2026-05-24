import { useState } from "react";
import type { Job } from "../types";
import { analyzeJob, generateApplicationPack } from "../api";
import ApplicationPack from "./ApplicationPack";

interface Props {
  job: Job;
  onBack: () => void;
  onDeleted: (id: string) => void;
}

const PROVIDERS = [
  { id: "nvidia",    label: "NVIDIA NIM (Llama 3.3 70B)" },
  { id: "anthropic", label: "Claude Opus 4.7" },
  { id: "openai",    label: "GPT-4o" },
  { id: "gemini",    label: "Gemini 1.5 Pro" },
];

export default function JobDetail({ job, onBack, onDeleted }: Props) {
  const [resume, setResume] = useState("");
  const [provider, setProvider] = useState("nvidia");
  const [apiKey, setApiKey] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [pack, setPack] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

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
          <h3 style={{ fontSize: 15, color: "#1a202c", marginBottom: 8 }}>Description</h3>
          <div
            style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap" }}
            dangerouslySetInnerHTML={{ __html: job.description.replace(/<[^>]+>/g, " ").trim() }}
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

        <section style={{ marginTop: 32, padding: 16, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>AI Job Fit Analysis</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
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
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={`${PROVIDERS.find(p => p.id === provider)?.label} API key (optional if set on server)`}
            style={{ ...inputStyle, marginTop: 8 }}
          />
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
            result={pack as Parameters<typeof ApplicationPack>[0]["result"]}
            onClose={() => setPack(null)}
          />
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
