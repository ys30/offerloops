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
}

export interface Stats {
  total_jobs: number;
  by_source: Record<string, number>;
  remote_jobs: number;
  ai_scored: number;
}
