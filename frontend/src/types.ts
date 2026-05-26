export interface JobLocation {
  city?: string;
  state?: string;
  country: string;
  remote: boolean;
  raw?: string;
}

export interface SalaryRange {
  min?: number;
  max?: number;
  currency: string;
  period: string;
}

export interface Job {
  id: string;
  source: string;
  source_id?: string;
  title: string;
  company: string;
  location: JobLocation;
  salary?: SalaryRange;
  description: string;
  requirements: string[];
  tags: string[];
  job_type: string;
  posted_date?: string;
  deadline?: string;
  apply_url?: string;
  created_at: string;
  updated_at: string;
  ai_summary?: string;
  ai_score?: number;
  ai_tags: string[];
  status: string;
  applied_date?: string;
  notes?: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  location?: string;
}

export interface EmailEvent {
  id: string;
  job_id?: string;
  sender: string;
  subject: string;
  snippet: string;
  detected_status?: string;
  company_guess?: string;
  role_guess?: string;
  email_date: string;
}

export interface GmailStatus {
  connected: boolean;
  last_synced_at?: string;
}

export interface Stats {
  total_jobs: number;
  by_source: Record<string, number>;
  remote_jobs: number;
  ai_scored: number;
}

export interface MarketData {
  industry: { industry: string; total: number; last_24h: number; last_7d: number }[];
  activity: Record<string, {
    total: number;
    by_state: { state: string; count: number }[];
    by_source: Record<string, number>;
  }>;
  trending: { state: string; current_24h: number; prev_24h: number; delta: number; pct_change: number }[];
  salary: {
    overall_avg_min: number | null;
    overall_avg_max: number | null;
    by_state: { state: string; avg_min: number; avg_max: number | null; count: number }[];
    by_source: { source: string; avg_min: number; avg_max: number | null; count: number }[];
  };
  summary: {
    total_jobs: number;
    remote_pct: number;
    top_companies: { company: string; count: number }[];
    score_distribution: { excellent: number; good: number; low: number; unscored: number };
    by_job_type: Record<string, number>;
  };
}
