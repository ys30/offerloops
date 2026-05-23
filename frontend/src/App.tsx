import { useEffect, useState, useCallback } from "react";
import { fetchJobs, fetchStats } from "./api";
import type { Job, Stats } from "./types";
import JobCard from "./components/JobCard";
import JobDetail from "./components/JobDetail";
import AddJobForm from "./components/AddJobForm";
import IngestPanel from "./components/IngestPanel";

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showIngest, setShowIngest] = useState(false);
  const [loading, setLoading] = useState(false);

  // Search / filter state
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<boolean | undefined>();
  const [source, setSource] = useState("");

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJobs({ q: q || undefined, remote, source: source || undefined, limit: 100 });
      setJobs(data);
    } finally {
      setLoading(false);
    }
  }, [q, remote, source]);

  const loadStats = useCallback(async () => {
    try {
      const s = await fetchStats();
      setStats(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadJobs();
    loadStats();
  }, [loadJobs, loadStats]);

  const selected = jobs.find(j => j.id === selectedId);

  if (selected) {
    return (
      <div style={pageStyle}>
        <Header stats={stats} />
        <main style={mainStyle}>
          <JobDetail
            job={selected}
            onBack={() => setSelectedId(null)}
            onDeleted={id => {
              setJobs(j => j.filter(x => x.id !== id));
              setSelectedId(null);
              loadStats();
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <Header stats={stats} />
      <main style={mainStyle}>
        {/* Search bar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            style={{ ...searchInput, flex: 1, minWidth: 200 }}
            placeholder="Search jobs, companies, keywords…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && loadJobs()}
          />
          <select
            style={selectStyle}
            value={source}
            onChange={e => setSource(e.target.value)}
          >
            <option value="">All sources</option>
            <option value="usajobs">USAJobs</option>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="manual">Manual</option>
          </select>
          <select
            style={selectStyle}
            value={remote === undefined ? "" : String(remote)}
            onChange={e => setRemote(e.target.value === "" ? undefined : e.target.value === "true")}
          >
            <option value="">Any location</option>
            <option value="true">Remote only</option>
            <option value="false">On-site</option>
          </select>
          <button onClick={loadJobs} style={primaryBtn}>Search</button>
          <button onClick={() => setShowAdd(true)} style={secondaryBtn}>+ Add Job</button>
          <button onClick={() => setShowIngest(v => !v)} style={secondaryBtn}>
            {showIngest ? "Hide Import" : "Import from Source"}
          </button>
        </div>

        {showIngest && (
          <div style={{ marginBottom: 16 }}>
            <IngestPanel onDone={() => { loadJobs(); loadStats(); }} />
          </div>
        )}

        {/* Results */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Loading…</div>
        ) : jobs.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div>No jobs yet. Import from a source or add one manually.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
              {jobs.length} job{jobs.length !== 1 ? "s" : ""}
            </div>
            {jobs.map(j => (
              <JobCard key={j.id} job={j} onSelect={setSelectedId} />
            ))}
          </div>
        )}
      </main>

      {showAdd && (
        <AddJobForm
          onCreated={() => { loadJobs(); loadStats(); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

function Header({ stats }: { stats: Stats | null }) {
  return (
    <header style={{
      background: "#1e293b",
      color: "#fff",
      padding: "14px 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
    }}>
      <div>
        <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: -0.5 }}>FlowHire</span>
        <span style={{ marginLeft: 8, fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
          open API · Claude Opus 4.7
        </span>
      </div>
      {stats && (
        <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#94a3b8" }}>
          <span><b style={{ color: "#fff" }}>{stats.total_jobs}</b> jobs</span>
          <span><b style={{ color: "#fff" }}>{stats.remote_jobs}</b> remote</span>
          <span><b style={{ color: "#fff" }}>{stats.ai_scored}</b> AI-scored</span>
        </div>
      )}
    </header>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#f8fafc",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const mainStyle: React.CSSProperties = {
  maxWidth: 900,
  margin: "0 auto",
  padding: "24px 16px",
};

const searchInput: React.CSSProperties = {
  padding: "9px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 7,
  fontSize: 14,
  background: "#fff",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  padding: "9px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 7,
  fontSize: 13,
  background: "#fff",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  padding: "9px 18px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const secondaryBtn: React.CSSProperties = {
  ...primaryBtn,
  background: "#fff",
  color: "#334155",
  border: "1px solid #e2e8f0",
};
