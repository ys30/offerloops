import { useState } from "react";
import { importJobFromUrl, ingestCompany, ingestUSAJobs } from "../api";

const TABS = [
  { id: "link",       label: "🔗 From Link" },
  { id: "usajobs",    label: "USAJobs" },
  { id: "greenhouse", label: "Greenhouse" },
  { id: "lever",      label: "Lever" },
  { id: "ashby",      label: "Ashby" },
  { id: "80k",        label: "80k Hours" },
  { id: "climatebase",label: "Climatebase" },
] as const;

type TabId = typeof TABS[number]["id"];

const SLUG_TABS: TabId[] = ["greenhouse", "lever", "ashby"];
const NO_SLUG_TABS: TabId[] = ["80k", "climatebase"];

interface Props { onDone: () => void }

export default function IngestPanel({ onDone }: Props) {
  const [tab, setTab] = useState<TabId>("link");
  // link tab
  const [linkUrl, setLinkUrl] = useState("");
  const [linkUrls, setLinkUrls] = useState<string[]>([]);
  const [linkResults, setLinkResults] = useState<{ url: string; status: "pending" | "ok" | "dup" | "err"; msg: string }[]>([]);
  // other tabs
  const [keyword, setKeyword] = useState("");
  const [org, setOrg] = useState("");
  const [location, setLocation] = useState("");
  const [slug, setSlug] = useState("");
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState("");

  function addLink() {
    const u = linkUrl.trim();
    if (!u) return;
    if (!linkUrls.includes(u)) setLinkUrls(prev => [...prev, u]);
    setLinkUrl("");
  }

  async function handleImportLinks() {
    if (linkUrls.length === 0) return;
    setRunning(true);
    setMsg("");
    const provider = localStorage.getItem("ol_ai_provider") || "nvidia";
    const apiKey = localStorage.getItem("ol_ai_key") || undefined;
    const results: typeof linkResults = linkUrls.map(u => ({ url: u, status: "pending", msg: "" }));
    setLinkResults([...results]);
    let ingested = 0, skipped = 0;
    for (let i = 0; i < linkUrls.length; i++) {
      try {
        const r = await importJobFromUrl(linkUrls[i], provider, apiKey);
        if (r.skipped === 1) {
          results[i] = { url: linkUrls[i], status: "dup", msg: `Already in list: ${r.title} @ ${r.company}` };
          skipped++;
        } else {
          results[i] = { url: linkUrls[i], status: "ok", msg: `Added: ${r.title} @ ${r.company}` };
          ingested++;
        }
      } catch (e) {
        results[i] = { url: linkUrls[i], status: "err", msg: e instanceof Error ? e.message : "Failed" };
      }
      setLinkResults([...results]);
    }
    setMsg(`✓ ${ingested} added, ${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped`);
    if (ingested > 0) onDone();
    setRunning(false);
  }

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
            onClick={() => { setTab(t.id); setMsg(""); setLinkResults([]); }}
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

      {tab === "link" && (
        <div>
          <div style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>
            Paste job URLs one at a time — works with Workday, LinkedIn, Indeed, USAJobs, company sites, or any link. Duplicates are skipped automatically.
          </div>

          {/* URL queue */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              style={inp}
              type="url"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
              placeholder="https://erm.wd3.myworkdayjobs.com/…"
            />
            <button
              type="button"
              onClick={addLink}
              disabled={!linkUrl.trim()}
              style={{ padding: "7px 14px", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
            >
              + Add
            </button>
          </div>

          {linkUrls.length > 0 && (
            <div style={{ marginBottom: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {linkUrls.map((u, i) => {
                const res = linkResults[i];
                return (
                  <div key={u} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: !res ? "#94a3b8" : res.status === "ok" ? "#16a34a" : res.status === "dup" ? "#f59e0b" : res.status === "err" ? "#dc2626" : "#2563eb",
                    }} />
                    <span style={{ flex: 1, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {res?.msg || u}
                    </span>
                    {!running && !res && (
                      <button onClick={() => setLinkUrls(prev => prev.filter((_, j) => j !== i))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14, padding: 0 }}>✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {msg && (
            <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: msg.startsWith("✓") ? "#166534" : "#dc2626" }}>
              {msg}
            </div>
          )}

          <button
            onClick={handleImportLinks}
            disabled={running || linkUrls.length === 0}
            style={{ padding: "7px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
          >
            {running ? "Importing…" : `Import ${linkUrls.length > 0 ? `${linkUrls.length} link${linkUrls.length !== 1 ? "s" : ""}` : ""}`}
          </button>
        </div>
      )}

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

      {tab !== "link" && (
        <>
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
        </>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: "7px 10px", border: "1px solid #cbd5e1",
  borderRadius: 6, fontSize: 13, width: "100%", boxSizing: "border-box",
};
