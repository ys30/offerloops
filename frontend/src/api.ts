import type { Job, Stats } from "./types";

const BASE = "/api";

export async function fetchJobs(params: Record<string, string | number | boolean | undefined> = {}): Promise<Job[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const res = await fetch(`${BASE}/jobs?${qs}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchJob(id: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createJob(payload: Record<string, unknown>): Promise<Job> {
  const res = await fetch(`${BASE}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteJob(id: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${BASE}/stats`);
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
  const res = await fetch(`${BASE}/ingest/usajobs?${qs}`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ingestCompany(
  platform: "greenhouse" | "lever",
  slug: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/ingest/${platform}/${slug}`, { method: "POST" });
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, resume_text: resumeText, provider, api_key: apiKey }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function analyzeJob(
  jobId: string,
  resumeText: string,
  provider: string = "anthropic",
  apiKey?: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/ai/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_id: jobId, resume_text: resumeText, provider, api_key: apiKey }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
