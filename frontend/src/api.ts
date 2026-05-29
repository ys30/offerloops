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

async function extractDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    const obj = JSON.parse(text);
    const d = obj.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join("; ");
    return text;
  } catch {
    return `HTTP ${res.status}`;
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

export async function extractJobFromUrl(url: string, provider = "nvidia", apiKey?: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/jobs/extract-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ url, provider, api_key: apiKey || null }),
  });
  if (!res.ok) throw new Error(await safeDetail(res, "Extraction failed"));
  return res.json();
}

export async function extractJobFromText(text: string, applyUrl: string, provider = "nvidia", apiKey?: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/jobs/extract-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ text, apply_url: applyUrl, provider, api_key: apiKey || null }),
  });
  if (!res.ok) throw new Error(await safeDetail(res, "Extraction failed"));
  return res.json();
}

export async function importJobFromUrl(url: string, provider = "nvidia", apiKey?: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/jobs/import-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ url, provider, api_key: apiKey || null }),
  });
  if (!res.ok) {
    let detail: string;
    try { const b = await res.json(); detail = b.detail ?? `HTTP ${res.status}`; }
    catch { detail = `HTTP ${res.status} — check you are logged in and API key is set in Profile`; }
    throw new Error(detail);
  }
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

export async function fetchPatterns(): Promise<{
  by_industry: PatternRow[];
  by_source: PatternRow[];
  by_score_band: PatternRow[];
  total: number;
}> {
  const res = await fetch(`${BASE}/patterns`, { headers: authHeaders() });
  if (!res.ok) return { by_industry: [], by_source: [], by_score_band: [], total: 0 };
  return res.json();
}

export interface PatternRow {
  name: string;
  total: number;
  positive: number;
  negative: number;
  pending: number;
  positive_rate: number;
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

// ── Projects ──────────────────────────────────────────────────────

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  role?: string;
  tech_stack: string[];
  outcome?: string;
  url?: string;
  dates?: string;
  created_at?: string;
  updated_at?: string;
}

export type ProjectPayload = Omit<Project, "id" | "user_id" | "created_at" | "updated_at">;

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${BASE}/projects`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

function projectBody(payload: Partial<ProjectPayload>): string {
  return JSON.stringify({
    name: payload.name ?? "",
    description: payload.description ?? null,
    role: payload.role ?? null,
    tech_stack: Array.isArray(payload.tech_stack) ? payload.tech_stack : [],
    outcome: payload.outcome ?? null,
    url: payload.url ?? null,
    dates: payload.dates ?? null,
  });
}

export async function createProject(payload: Partial<ProjectPayload>): Promise<Project> {
  const res = await fetch(`${BASE}/projects`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: projectBody(payload),
  });
  if (!res.ok) throw new Error(await extractDetail(res));
  return res.json();
}

export async function updateProject(id: string, payload: Partial<ProjectPayload>): Promise<Project> {
  const res = await fetch(`${BASE}/projects/${id}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: projectBody(payload),
  });
  if (!res.ok) throw new Error(await extractDetail(res));
  return res.json();
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`${BASE}/projects/${id}`, { method: "DELETE", headers: authHeaders() });
}

export async function suggestProjectOutcome(
  project: Partial<ProjectPayload>,
  provider = "nvidia",
  apiKey?: string,
): Promise<string> {
  const qs = new URLSearchParams({ provider });
  if (apiKey) qs.set("api_key", apiKey);
  const res = await fetch(`${BASE}/projects/suggest-outcome?${qs}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      name: project.name || "",
      description: project.description || null,
      role: project.role || null,
      tech_stack: Array.isArray(project.tech_stack) ? project.tech_stack : [],
    }),
  });
  if (!res.ok) throw new Error(await extractDetail(res));
  const data = await res.json();
  return data.outcome;
}

export async function uploadProjectDoc(
  file: File,
  provider = "nvidia",
  apiKey?: string,
): Promise<Project> {
  const form = new FormData();
  form.append("file", file);
  const qs = new URLSearchParams({ provider });
  if (apiKey) qs.set("api_key", apiKey);
  const res = await fetch(`${BASE}/projects/upload?${qs}`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) throw new Error(await extractDetail(res));
  return res.json();
}

// ── STAR Story Bank ────────────────────────────────────────────────

export interface Story {
  id: string;
  user_id: string;
  title: string;
  situation?: string;
  task?: string;
  action?: string;
  result?: string;
  reflection?: string;
  category: string;
  skills: string[];
  linked_job_ids: string[];
  ai_polished: boolean;
  created_at?: string;
  updated_at?: string;
  // from recommend endpoint
  relevance_score?: number;
  ai_reason?: string;
  linked?: boolean;
}

export type StoryPayload = Omit<Story, "id" | "user_id" | "created_at" | "updated_at" | "relevance_score" | "linked">;

export async function fetchStories(jobId?: string): Promise<Story[]> {
  const qs = jobId ? `?job_id=${jobId}` : "";
  const res = await fetch(`${BASE}/stories${qs}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function createStory(payload: Partial<StoryPayload>): Promise<Story> {
  const res = await fetch(`${BASE}/stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateStory(id: string, payload: Partial<StoryPayload>): Promise<Story> {
  const res = await fetch(`${BASE}/stories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteStory(id: string): Promise<void> {
  await fetch(`${BASE}/stories/${id}`, { method: "DELETE", headers: authHeaders() });
}

export async function generateStories(
  provider = "nvidia",
  apiKey?: string,
): Promise<Story[]> {
  const qs = new URLSearchParams({ provider });
  if (apiKey) qs.set("api_key", apiKey);
  const res = await fetch(`${BASE}/stories/generate?${qs}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function polishStory(
  id: string,
  provider = "nvidia",
  apiKey?: string,
): Promise<Story> {
  const qs = new URLSearchParams({ provider });
  if (apiKey) qs.set("api_key", apiKey);
  const res = await fetch(`${BASE}/stories/${id}/polish?${qs}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function recommendStories(jobId: string): Promise<Story[]> {
  const res = await fetch(`${BASE}/stories/recommend?job_id=${jobId}`, { headers: authHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function scoreStoriesAI(
  jobId: string,
  provider = "nvidia",
  apiKey?: string,
): Promise<Story[]> {
  const qs = new URLSearchParams({ job_id: jobId, provider });
  const res = await fetch(`${BASE}/stories/score-ai?${qs}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey || null }),
  });
  if (!res.ok) throw new Error(await safeDetail(res, "AI scoring failed"));
  return res.json();
}

export async function linkStory(storyId: string, jobId: string): Promise<Story> {
  const res = await fetch(`${BASE}/stories/${storyId}/link?job_id=${jobId}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function unlinkStory(storyId: string, jobId: string): Promise<Story> {
  const res = await fetch(`${BASE}/stories/${storyId}/link?job_id=${jobId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
