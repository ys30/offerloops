import { useState } from "react";
import { ingestCompany, ingestUSAJobs } from "../api";

interface Props {
  onDone: () => void;
}

export default function IngestPanel({ onDone }: Props) {
  const [tab, setTab] = useState<"usajobs" | "greenhouse" | "lever">("usajobs");
  const [keyword, setKeyword] = useState("");
  const [org, setOrg] = useState("");
  const [location, setLocation] = useState("");
  const [slug, setSlug] = useState("");
  const [usaJobsKey, setUsaJobsKey] = useState("");
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleRun() {
    setRunning(true);
    setMsg("");
    try {
      let result: Record<string, unknown>;
      if (tab === "usajobs") {
        result = await ingestUSAJobs({ keyword, organization: org, location, pages: 2 });
      } else {
        result = await ingestCompany(tab, slug);
      }
      setMsg(`✓ Ingested ${result.ingested}, skipped ${result.skipped}`);
      onDone();
    } catch (e: unknown) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#1a202c" }}>Import Jobs</h3>

      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["usajobs", "greenhouse", "lever"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
              border: "1px solid #e2e8f0",
              borderRadius: 5,
              background: tab === t ? "#2563eb" : "#fff",
              color: tab === t ? "#fff" : "#374151",
              cursor: "pointer",
            }}
          >
            {t === "usajobs" ? "USAJobs (Federal)" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "usajobs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input style={inp} placeholder="Keyword (e.g. data scientist)" value={keyword} onChange={e => setKeyword(e.target.value)} />
          <input style={inp} placeholder="Agency code: EP=EPA, GS=USGS, IN=Interior" value={org} onChange={e => setOrg(e.target.value)} />
          <input style={inp} placeholder="Location (e.g. Remote, New Mexico)" value={location} onChange={e => setLocation(e.target.value)} />
        </div>
      )}

      {(tab === "greenhouse" || tab === "lever") && (
        <input
          style={inp}
          placeholder={`Company slug (e.g. "stripe", "airbnb")`}
          value={slug}
          onChange={e => setSlug(e.target.value)}
        />
      )}

      {msg && (
        <div style={{
          marginTop: 8,
          fontSize: 12,
          color: msg.startsWith("✓") ? "#166534" : "#dc2626",
          fontWeight: 600,
        }}>
          {msg}
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={running || (tab !== "usajobs" && !slug.trim())}
        style={{
          marginTop: 10,
          padding: "7px 16px",
          background: "#2563eb",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {running ? "Importing…" : "Import"}
      </button>
    </div>
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
