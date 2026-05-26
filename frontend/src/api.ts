import type { EmailEvent, GmailStatus, Job, MarketData, Stats, User } from "./types";

const BASE = "/api";

export function getToken(): string | null {
  return localStorage.getItem("ol_token");
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function safeDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body.detail ?? fallback;
  } catch {
    return fallback;
  }
}

export async function signup(payload: {
  email: string; password: string; name?: string; phone?: string; location?: string;
}): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await safeDetail(res, "Signup failed"));
  return res.json();
}

export async function login(email: string, password: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await safeDetail(res, "Login failed"));
  return res.json();
}

export async function fetchMe(): Promise<User> {
  const res = await fetch(`${BASE}/auth/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

export async function updateMe(payload: Partial<User>): Promise<User> {
  const res = await fetch(`${BASE}/auth/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).detail ?? "Update failed");
  return res.json();
}

export async function forgotPassword(email: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const body = await res.json();
  return body.detail ?? "Check your email.";
}

export async function resetPassword(token: string, password: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE}/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  if (!res.ok) throw new Error(await safeDetail(res, "Reset failed"));
  return res.json();
}

export async function fetchAuthProviders(): Promise<{ google: boolean; google_client_id?: string; github: boolean; linkedin: boolean; microsoft: boolean }> {
  const res = await fetch(`${BASE}/auth/providers`);
  return res.json();
}

export async function googleAuth(credential: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BASE}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw new Error(await safeDetail(res, "Google sign-in failed"));
  return res.json();
}

export async function fetchJobs(params: Record<string, string | number | boolean | undefined> = {}): Promise<{ jobs: Job[]; total: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`${BASE}/jobs?${qs}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const jobs: Job[] = await res.json();
  const total = parseInt(res.headers.get("X-Total-Count") ?? String(jobs.length), 10);
  return { jobs, total };
}

export async function fetchJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createJob(payload: Record<string, unknown>): Promise<Job> {
  const res = await fetch(`${BASE}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteJob(id: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
}

export async function updateJobStatus(
  id: string,
  status: string,
  notes?: string,
  appliedDate?: string,
): Promise<Job> {
  const body: Record<string, string> = { status };
  if (notes !== undefined) body.notes = notes;
  if (appliedDate !== undefined) body.applied_date = appliedDate;
  const res = await fetch(`${BASE}/jobs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchTracker(): Promise<Record<string, Job[]>> {
  const res = await fetch(`${BASE}/tracker`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchFollowups(): Promise<(Job & { followup_due_days: number; days_overdue: number })[]> {
  const res = await fetch(`${BASE}/followups`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${BASE}/stats`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchMarket(): Promise<MarketData> {
  const res = await fetch(`${BASE}/market`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchTags(): Promise<{ tag: string; count: number }[]> {
  const res = await fetch(`${BASE}/tags`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchIndustries(): Promise<{ industry: string; total: number; last_24h: number; last_7d: number }[]> {
  const res = await fetch(`${BASE}/industries`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ingestUSAJobs(params: {
  keyword?: string;
  organization?: string;
  location?: string;
  pages?: number;
}): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  if (params.keyword) qs.set("keyword", params.keyword);
  if (params.organization) qs.set("organization", params.organization);
  if (params.location) qs.set("location", params.location);
  if (params.pages) qs.set("pages", String(params.pages));
  const res = await fetch(`${BASE}/ingest/usajobs?${qs}`, { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ingestCompany(
  platform: "greenhouse" | "lever",
  slug: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/ingest/${platform}/${slug}`, { method: "POST", headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateApplicationPack(
  jobId: string,
  resumeText: string,
  provider: string = "nvidia",
  apiKey?: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/ai/application-pack`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ job_id: jobId, resume_text: resumeText, provider, api_key: apiKey }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function analyzeJob(
  jobId: string,
  resumeText: string | undefined,
  provider: string = "anthropic",
  apiKey?: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/ai/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ job_id: jobId, resume_text: resumeText || undefined, provider, api_key: apiKey }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export async function fetchDashboard(): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/dashboard`, { headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Gmail ──────────────────────────────────────────────────────────────────

export async function fetchGmailStatus(): Promise<GmailStatus> {
  const res = await fetch(`${BASE}/gmail/status`, { headers: authHeaders() });
  return res.json();
}

export function startGmailAuth(token: string): void {
  window.location.href = `/api/gmail/auth?token=${encodeURIComponent(token)}`;
}

export async function disconnectGmail(): Promise<void> {
  const res = await fetch(`${BASE}/gmail/disconnect`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await safeDetail(res, "Disconnect failed"));
}

export async function syncGmail(daysBack = 60): Promise<{ scanned: number; new_events: number; jobs_updated: number }> {
  const res = await fetch(`${BASE}/gmail/sync?days_back=${daysBack}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await safeDetail(res, "Sync failed"));
  return res.json();
}

export async function fetchEmailEvents(jobId?: string): Promise<EmailEvent[]> {
  const qs = jobId ? `?job_id=${jobId}` : "";
  const res = await fetch(`${BASE}/gmail/events${qs}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}
