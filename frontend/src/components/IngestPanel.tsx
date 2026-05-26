import { useState } from "react";
import { ingestCompany, ingestUSAJobs } from "../api";

const TABS = [
  { id: "usajobs",     label: "USAJobs" },
  { id: "greenhouse",  label: "Greenhouse" },
  { id: "lever",       label: "Lever" },
  { id: "ashby",       label: "Ashby" },
  { id: "80k",         label: "80k Hours" },
  { id: "climatebase", label: "Climatebase" },
] as const;

type TabId = typeof TABS[number]["id"];

const SLUG_TABS: TabId[] = ["greenhouse", "lever", "ashby"];
const NO_SLUG_TABS: TabId[] = ["80k", "climatebase"];

interface Props { onDone: () => void }

export default function IngestPanel({ onDone }: Props) {
  const [tab, setTab] = useState<TabId>("usajobs");
  const [keyword, setKeyword] = useState("");
  const [org, setOrg] = useState("");
  const [location, setLocation] = useState("");
  const [slug, setSlug] = useState("");
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleRun() {
    setRunning(true);
    setMsg("");
    try {
      let result: Record<string, unknown>;
      if (tab === "usajobs") {
        result = await ingestUSAJobs({ keyword, organization: org, location, pages: 2 });
      } else if (NO_SLUG_TABS.includes(tab)) {
        const endpoint = tab === "80k" ? "/api/ingest/80k" : "/api/ingest/climatebase";
        const res = await fetch(endpoint, { method: "POST" });
        if (!res.ok) throw new Error(await res.text());
        result = await res.json();
      } else {
        // Greenhouse / Lever / Ashby — need company slug
        if (tab === "ashby") {
          const res = await fetch(`/api/ingest/ashby/${slug.trim()}`, { method: "POST" });
          if (!res.ok) throw new Error(await res.text());
          result = await res.json();
        } else {
          result = await ingestCompany(tab as "greenhouse" | "lever", slug.trim());
        }
      }
      setMsg(`✓ Ingested ${result.ingested ?? "?"}, skipped ${result.skipped ?? "?"}`);
      onDone();
    } catch (e: unknown) {
      setMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  const needsSlug = SLUG_TABS.includes(tab);

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 }}>
      <h3 style={{ margin: "0 0 12px", fontSize: 14, color: "#1a202c" }}>Import Jobs</h3>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "5px 12px", fontSize: 12, fontWeight: 600,
              border: "1px solid #e2e8f0", borderRadius: 5,
              background: tab === t.id ? "#2563eb" : "#fff",
              color: tab === t.id ? "#fff" : "#374151",
              cursor: "pointer",
            }}
          >
            {t.label}
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

      {needsSlug && (
        <input
          style={inp}
          placeholder={`Company slug (e.g. "watershed", "nrdc", "planet")`}
          value={slug}
          onChange={e => setSlug(e.target.value)}
        />
      )}

      {NO_SLUG_TABS.includes(tab) && (
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {tab === "80k" && "Fetches all current listings from 80,000 Hours job board."}
          {tab === "climatebase" && "Fetches climate-focused jobs from Climatebase.org."}
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: msg.startsWith("✓") ? "#166534" : "#dc2626" }}>
          {msg}
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={running || (needsSlug && !slug.trim())}
        style={{ marginTop: 10, padding: "7px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
      >
        {running ? "Importing…" : "Import"}
      </button>
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: "7px 10px", border: "1px solid #cbd5e1",
  borderRadius: 6, fontSize: 13, width: "100%", boxSizing: "border-box",
};
