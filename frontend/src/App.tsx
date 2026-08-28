import { useEffect, useState, useCallback } from "react";
import { fetchJobs, fetchStats, fetchMe, getToken, updateJobStatus, fetchGmailStatus, syncGmail } from "./api";
import IndustryMultiSelect from "./components/IndustryMultiSelect";
import type { Job, Stats, User } from "./types";
import JobCard from "./components/JobCard";
import JobDetail from "./components/JobDetail";
import AddJobForm from "./components/AddJobForm";
import IngestPanel from "./components/IngestPanel";
import ScoreAllPanel from "./components/ScoreAllPanel";
import ProfilePage from "./pages/ProfilePage";
import AuthPage from "./pages/AuthPage";
import TrackerPage from "./pages/TrackerPage";
import DashboardPage from "./pages/DashboardPage";
import MarketPage from "./pages/MarketPage";
import StoryBankPage from "./pages/StoryBankPage";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showIngest, setShowIngest] = useState(false);
  const [showScoreAll, setShowScoreAll] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [showStories] = useState(false);
  const [loading, setLoading] = useState(false);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [justConnectedGmail, setJustConnectedGmail] = useState(false);
  const [gmailErrorMsg, setGmailErrorMsg] = useState<string | null>(null);

  // Restore session — also handle OAuth (?token=) and password reset (?reset_token=) redirects
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirectToken = params.get("token");
    const rt = params.get("reset_token");
    if (redirectToken) {
      localStorage.setItem("ol_token", redirectToken);
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (rt) {
      setResetToken(rt);
      setShowAuthModal(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
    const authError = params.get("auth_error");
    if (authError) window.history.replaceState({}, "", window.location.pathname);
    const gmailConnected = params.get("gmail_connected");
    const gmailError = params.get("gmail_error");
    if (gmailConnected || gmailError) window.history.replaceState({}, "", window.location.pathname);
    if (gmailConnected) {
      setJustConnectedGmail(true);
      setTimeout(() => setShowProfile(true), 100);
    }
    if (gmailError) {
      setGmailErrorMsg(gmailError);
      setTimeout(() => setShowProfile(true), 100);
    }

    if (getToken()) {
      fetchMe().then(setUser).catch(() => localStorage.removeItem("ol_token")).finally(() => setAuthChecked(true));
    } else {
      setAuthChecked(true);
    }
  }, []);

  function handleAuth(_token: string, u: User) {
    setUser(u);
    setShowAuthModal(false);
    setPage(1);
    loadJobs(1);
    loadStats();
  }

  function handleLogout() {
    localStorage.removeItem("ol_token");
    setUser(null);
  }

  // Search / filter state
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [usOnly, setUsOnly] = useState(false);
  const [remote, setRemote] = useState<boolean | undefined>();
  const [source, setSource] = useState("");
  const [selectedIndustries, setSelectedIndustries] = useState<Set<string>>(new Set());
  const [days, setDays] = useState<number | undefined>(60);
  const [sort, setSort] = useState("date");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 50;

  const loadJobs = useCallback(async (targetPage = page, overrideSort?: string) => {
    setLoading(true);
    try {
      const { jobs: data, total: t } = await fetchJobs({
        q: q || undefined,
        location: location || undefined,
        us_only: usOnly || undefined,
        remote,
        source: source || undefined,
        industries: selectedIndustries.size > 0 ? Array.from(selectedIndustries).join(",") : undefined,
        days: days ?? undefined,
        sort: overrideSort ?? sort,
        limit: PAGE_SIZE,
        offset: (targetPage - 1) * PAGE_SIZE,
      });
      setJobs(data);
      setTotal(t);
    } catch { /* ignore */ }
    finally {
      setLoading(false);
    }
  }, [q, location, usOnly, remote, source, selectedIndustries, sort, page]);

  const loadStats = useCallback(async () => {
    try {
      const s = await fetchStats();
      setStats(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    loadJobs(page);
    loadStats();
  }, [loadJobs, loadStats, page, authChecked]);

  // Background Gmail auto-sync: runs once when user logs in, silently updates job statuses
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const s = await fetchGmailStatus();
        if (!s.connected) return;
        const lastSyncMs = s.last_synced_at ? new Date(s.last_synced_at).getTime() : 0;
        if (Date.now() - lastSyncMs < 15 * 60 * 1000) return; // synced recently
        const r = await syncGmail(60);
        if (r.jobs_updated > 0) {
          // Reload jobs so status dropdowns/badges reflect new statuses
          loadJobs(page);
        }
      } catch { /* silent — sync failure shouldn't interrupt the UI */ }
    })();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = jobs.find(j => j.id === selectedId);

  if (!authChecked) return null;

  const goJobs = () => { setShowProfile(false); setShowDashboard(false); setShowMarket(false); setShowTracker(false); setShowStories(false); setSelectedId(null); };

  // Shared header props — same nav on every page
  const headerProps = {
    stats, user,
    onJobs:      goJobs,
    onProfile:   () => { setShowProfile(true); setShowDashboard(false); setShowMarket(false); setShowTracker(false); setShowStories(false); },
    onDashboard: () => { setShowDashboard(true); setShowProfile(false); setShowMarket(false); setShowTracker(false); setShowStories(false); },
    onMarket:    () => { setShowMarket(true); setShowProfile(false); setShowDashboard(false); setShowTracker(false); setShowStories(false); },
    onTracker:   () => { setShowTracker(true); setShowProfile(false); setShowDashboard(false); setShowMarket(false); },
    onStories:   () => {},
    onLogout:    handleLogout,
    onSignIn:    () => setShowAuthModal(true),
  };

  if (showProfile) {
    return (
      <div style={pageStyle}>
        {showAuthModal && <AuthPage onAuth={handleAuth} onClose={() => { setShowAuthModal(false); setResetToken(null); }} resetToken={resetToken} />}
        <Header {...headerProps} profileActive />
        <main style={mainStyle}>
          <ProfilePage onBack={goJobs} justConnectedGmail={justConnectedGmail} gmailError={gmailErrorMsg} />
        </main>
      </div>
    );
  }

  if (showTracker) {
    return (
      <div style={pageStyle}>
        {showAuthModal && <AuthPage onAuth={handleAuth} onClose={() => { setShowAuthModal(false); setResetToken(null); }} resetToken={resetToken} />}
        <Header {...headerProps} trackerActive />
        <main style={{ ...mainStyle, maxWidth: 1200 }}>
          <TrackerPage user={user} onSelectJob={id => { setShowTracker(false); setSelectedId(id); }} />
        </main>
      </div>
    );
  }

  if (showDashboard) {
    return (
      <div style={pageStyle}>
        {showAuthModal && <AuthPage onAuth={handleAuth} onClose={() => { setShowAuthModal(false); setResetToken(null); }} resetToken={resetToken} />}
        <Header {...headerProps} dashboardActive />
        <main style={{ ...mainStyle, maxWidth: 1140 }}>
          <DashboardPage onSelectJob={id => { setShowDashboard(false); setSelectedId(id); }} onStories={() => { setShowProfile(true); setShowDashboard(false); }} />
        </main>
      </div>
    );
  }

  if (showMarket) {
    return (
      <div style={pageStyle}>
        {showAuthModal && <AuthPage onAuth={handleAuth} onClose={() => { setShowAuthModal(false); setResetToken(null); }} resetToken={resetToken} />}
        <Header {...headerProps} marketActive />
        <main style={{ ...mainStyle, maxWidth: 1140 }}>
          <MarketPage onBack={goJobs} />
        </main>
      </div>
    );
  }


  if (selected) {
    return (
      <div style={pageStyle}>
        {showAuthModal && <AuthPage onAuth={handleAuth} onClose={() => { setShowAuthModal(false); setResetToken(null); }} resetToken={resetToken} />}
        <Header {...headerProps} />
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
      {showAuthModal && (
        <AuthPage onAuth={handleAuth} onClose={() => setShowAuthModal(false)} />
      )}
      <Header {...headerProps} jobsActive />
      <main style={mainStyle}>
        {/* Search bar */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            style={{ ...searchInput, flex: 1, minWidth: 200 }}
            placeholder="Search jobs, companies, keywords…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { setPage(1); loadJobs(1); } }}
          />
          <input
            style={{ ...searchInput, minWidth: 140 }}
            placeholder="State or city (e.g. NM, DC)"
            value={location}
            onChange={e => { setLocation(e.target.value); setPage(1); }}
            onKeyDown={e => { if (e.key === "Enter") { setPage(1); loadJobs(1); } }}
            autoComplete="off"
            name="job-location-filter"
          />
          <select
            style={selectStyle}
            value={source}
            onChange={e => { setSource(e.target.value); setPage(1); }}
          >
            <option value="">All sources</option>
            <option value="usajobs">USAJobs</option>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
            <option value="80k_hours">80,000 Hours</option>
            <option value="climatebase">Climatebase</option>
            <option value="manual">Manual</option>
          </select>
          <select
            style={selectStyle}
            value={remote === undefined ? "" : String(remote)}
            onChange={e => { setRemote(e.target.value === "" ? undefined : e.target.value === "true"); setPage(1); }}
          >
            <option value="">Any location</option>
            <option value="true">Remote only</option>
            <option value="false">On-site</option>
          </select>
          <div style={{ minWidth: 180 }}>
            <IndustryMultiSelect
              selected={selectedIndustries}
              onChange={next => { setSelectedIndustries(next); setPage(1); }}
            />
          </div>
          <select
            style={selectStyle}
            value={days === undefined ? "" : String(days)}
            onChange={e => { setDays(e.target.value === "" ? undefined : Number(e.target.value)); setPage(1); }}
          >
            <option value="">Any date</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <select
            style={selectStyle}
            value={sort}
            onChange={e => { setSort(e.target.value); setPage(1); }}
          >
            <option value="date">Newest first</option>
            <option value="score">Best match first</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#374151", whiteSpace: "nowrap", cursor: "pointer" }}>
            <input type="checkbox" checked={usOnly} onChange={e => { setUsOnly(e.target.checked); setPage(1); }} />
            US only
          </label>
          <button onClick={() => { setPage(1); loadJobs(1); }} style={primaryBtn}>
            Search{total > 0 && !loading ? ` (${total.toLocaleString()})` : ""}
          </button>
          <button onClick={() => setShowAdd(true)} style={secondaryBtn}>+ Add Job</button>
          <button onClick={() => setShowIngest(v => !v)} style={secondaryBtn}>
            {showIngest ? "Hide Import" : "Import from Source"}
          </button>
          <button onClick={() => setShowScoreAll(v => !v)} style={secondaryBtn}>
            {showScoreAll ? "Hide Score All" : "⚡ Score All"}
          </button>
        </div>

        {showIngest && (
          <div style={{ marginBottom: 16 }}>
            <IngestPanel onDone={() => { loadJobs(); loadStats(); }} />
          </div>
        )}

        {showScoreAll && (
          <ScoreAllPanel
            user={user}
            onSignIn={() => setShowAuthModal(true)}
            onDone={() => { setSort("score"); setPage(1); loadJobs(1, "score"); loadStats(); }}
            onClose={() => setShowScoreAll(false)}
          />
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
              {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} job{total !== 1 ? "s" : ""}
            </div>
            {jobs.map(j => (
              <JobCard
                key={j.id}
                job={j}
                onSelect={setSelectedId}
                onStatusChange={user ? async (jobId, status) => {
                  await updateJobStatus(jobId, status);
                  setJobs(prev => prev.map(x => x.id === jobId ? { ...x, status } : x));
                } : undefined}
              />
            ))}
            {total > PAGE_SIZE && (
              <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
            )}
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

function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const [jumpVal, setJumpVal] = useState("");
  const totalPages = Math.ceil(total / pageSize);

  const delta = 2;
  const pages: (number | "…")[] = [];
  const rangeStart = Math.max(2, page - delta);
  const rangeEnd = Math.min(totalPages - 1, page + delta);
  pages.push(1);
  if (rangeStart > 2) pages.push("…");
  for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
  if (rangeEnd < totalPages - 1) pages.push("…");
  if (totalPages > 1) pages.push(totalPages);

  function jump() {
    const n = parseInt(jumpVal, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) { onPage(n); setJumpVal(""); }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "16px 0", flexWrap: "wrap" }}>
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        style={{ ...secondaryBtn, opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? "default" : "pointer" }}
      >
        ← Prev
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} style={{ fontSize: 13, color: "#94a3b8" }}>…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p as number)}
            style={{
              ...secondaryBtn,
              minWidth: 36,
              padding: "9px 10px",
              background: page === p ? "#2563eb" : "#fff",
              color: page === p ? "#fff" : "#334155",
              border: page === p ? "1px solid #2563eb" : "1px solid #e2e8f0",
              fontWeight: page === p ? 700 : 400,
            }}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onPage(page + 1)}
        disabled={page * pageSize >= total}
        style={{ ...secondaryBtn, opacity: page * pageSize >= total ? 0.4 : 1, cursor: page * pageSize >= total ? "default" : "pointer" }}
      >
        Next →
      </button>
      <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 8 }}>Go to</span>
      <input
        type="number"
        min={1}
        max={totalPages}
        value={jumpVal}
        onChange={e => setJumpVal(e.target.value)}
        onKeyDown={e => e.key === "Enter" && jump()}
        placeholder="page"
        style={{ ...searchInput, width: 60, padding: "7px 8px", fontSize: 13 }}
      />
      <button onClick={jump} style={{ ...secondaryBtn, padding: "9px 12px" }}>Go</button>
    </div>
  );
}

function Header({ stats, user, onJobs, onProfile, onLogout, onSignIn, onDashboard, onMarket, onTracker, onStories, jobsActive, profileActive, dashboardActive, marketActive, trackerActive, storiesActive }: {
  stats: Stats | null;
  user: User | null;
  onJobs: () => void;
  onProfile: () => void;
  onLogout: () => void;
  onSignIn: () => void;
  onDashboard: () => void;
  onMarket: () => void;
  onTracker: () => void;
  onStories: () => void;
  jobsActive?: boolean;
  profileActive?: boolean;
  dashboardActive?: boolean;
  marketActive?: boolean;
  trackerActive?: boolean;
  storiesActive?: boolean;
}) {
  const navBtn = (active?: boolean): React.CSSProperties => ({
    padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer",
    background: active ? "#fff" : "rgba(255,255,255,0.12)",
    color: active ? "#1e293b" : "#e2e8f0",
    border: "1px solid rgba(255,255,255,0.2)",
  });
  return (
    <header style={{
      background: "#1e293b", color: "#fff", padding: "12px 24px",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ marginRight: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: -0.5 }}>OfferLoops</span>
          <span style={{ marginLeft: 8, fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
            open API · multi-model AI
          </span>
        </div>
        <button onClick={onJobs} style={navBtn(jobsActive)}>💼 Jobs</button>
        <button onClick={onTracker} style={navBtn(trackerActive)}>📋 Tracker</button>
        <button onClick={onDashboard} style={navBtn(dashboardActive)}>📊 Dashboard</button>
        <button onClick={onMarket} style={navBtn(marketActive)}>🌐 Market</button>
        <button onClick={onProfile} style={navBtn(profileActive)}>👤 Profile</button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {stats && (
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#94a3b8" }}>
            <span><b style={{ color: "#fff" }}>{stats.total_jobs}</b> jobs</span>
            <span><b style={{ color: "#fff" }}>{stats.remote_jobs}</b> remote</span>
            <span><b style={{ color: "#fff" }}>{stats.ai_scored}</b> AI-scored</span>
          </div>
        )}
        {user ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
            <span style={{ color: "#94a3b8" }}>{user.name || user.email}</span>
            <button onClick={onLogout} style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 5, cursor: "pointer",
              background: "rgba(255,255,255,0.1)", color: "#e2e8f0",
              border: "1px solid rgba(255,255,255,0.15)",
            }}>Sign out</button>
          </div>
        ) : (
          <button onClick={onSignIn} style={{
            padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer",
            background: "#2563eb", color: "#fff", border: "none",
          }}>Sign in</button>
        )}
      </div>
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
