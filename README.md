# FlowHire v2

Automated job search platform with a uniform data pipeline, open API, and bulk AI scoring — built for humans and AI agents alike.

## What it does

- **Aggregates jobs** from USAJobs (federal: EPA, USGS, DOE, NOAA), Greenhouse, and Lever into a single normalized schema
- **Bulk AI scoring** — score your entire job database against your saved resume in one click, with real-time progress streaming
- **Open REST API** — CORS-open, machine-readable, fully documented at `/api/docs`
- **Multi-model AI** — Anthropic Claude, OpenAI GPT-4o, NVIDIA NIM (Llama), and Gemini for scoring, resume tailoring, and cover letters
- **One-click application pack** — AI generates a tailored resume + cover letter for any job
- **Profile portal** — upload your resume (PDF/DOCX/TXT), import from LinkedIn, or paste text directly
- **Web portal** — search, filter, and manually add job postings via a React UI
- **BYOK** — bring your own API key per request, or set it server-side

## What's new in v2

- `POST /api/ai/score-all` — SSE streaming endpoint that scores all unscored jobs concurrently against your profile resume
- **Score All panel** in the UI — provider picker, real-time progress bar, live job log with color-coded fit scores, cancel support
- Configurable concurrency (default 3 parallel AI calls, up to 10)
- `max_tokens` parameterized across all AI provider call paths

## Quickstart

```bash
# 1. Copy and fill in API keys
cp .env.example .env

# 2. Install Python deps
uv venv .venv && uv pip install --python .venv/bin/python -r backend/requirements.txt

# 3. Install frontend deps
cd frontend && npm install && cd ..

# 4. Start both servers
./start.sh
```

Portal: http://localhost:5173  
API docs: http://localhost:8000/api/docs

## API keys needed

| Key | Where to get it | Required for |
|-----|----------------|--------------|
| `USAJOBS_API_KEY` | [developer.usajobs.gov](https://developer.usajobs.gov/APIRequest/Index) | Federal job import |
| `USAJOBS_USER_AGENT` | Your email address | Required with above |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Claude AI (optional — BYOK per request) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | GPT-4o (optional) |
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) | NVIDIA NIM / Llama (optional, free tier available) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) | Gemini (optional) |

## Importing jobs

```bash
# Import everything (all configured sources)
curl -X POST http://localhost:8000/api/ingest/all

# Import federal jobs by keyword
curl -X POST "http://localhost:8000/api/ingest/usajobs?keyword=water+quality&pages=2"

# Import a specific company (Greenhouse)
curl -X POST http://localhost:8000/api/ingest/greenhouse/watershed

# Import a specific company (Lever)
curl -X POST http://localhost:8000/api/ingest/lever/erg
```

## Bulk AI scoring

Score all unscored jobs in one call. The endpoint streams SSE progress events as each job is scored.

```bash
# Score all unscored jobs (uses server-side API key)
curl -X POST "http://localhost:8000/api/ai/score-all?provider=anthropic"

# Re-score everything, 5 concurrent calls, BYOK
curl -X POST "http://localhost:8000/api/ai/score-all?provider=anthropic&rescore=true&concurrency=5&api_key=sk-ant-..."
```

**SSE event format:**

| Event type | Fields |
|---|---|
| `start` | `total` |
| `progress` | `job_id`, `title`, `score`, `scored`, `failed`, `total` |
| `error` | `job_id`, `title`, `error`, `scored`, `failed`, `total` |
| `done` | `scored`, `failed`, `total` |

Or use the **⚡ Score All** button in the web portal for a visual progress panel.

## Key API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/jobs` | List/search jobs (`?q=`, `?remote=true`, `?source=usajobs`, `?min_score=3.5`) |
| `GET` | `/api/jobs/{id}` | Job detail |
| `POST` | `/api/jobs` | Manually add a job posting |
| `POST` | `/api/ingest/all` | Run all configured sources |
| `POST` | `/api/ai/score-all` | Bulk score all jobs vs profile resume (SSE stream) |
| `POST` | `/api/ai/analyze` | Score a single job vs resume |
| `POST` | `/api/ai/application-pack` | Generate tailored resume + cover letter |
| `POST` | `/api/ai/search` | Natural language job search |
| `GET` | `/api/ai/providers` | List available AI providers and configured status |
| `GET` | `/api/profile` | Get saved profile |
| `POST` | `/api/profile` | Save profile |
| `POST` | `/api/profile/upload` | Upload resume (PDF/DOCX/TXT) |
| `POST` | `/api/profile/linkedin` | Import profile from LinkedIn URL |
| `GET` | `/api/stats` | DB summary stats |

## Adding sources

Edit `backend/sources_config.py` to add new USAJobs searches or Greenhouse/Lever company slugs — no code changes needed.

## Stack

- **Backend:** Python · FastAPI · SQLAlchemy · SQLite · httpx
- **AI:** Anthropic SDK · OpenAI SDK · NVIDIA NIM · Google Gemini · prompt caching
- **Sources:** USAJobs API · Greenhouse Jobs API · Lever Postings API
- **Frontend:** React · TypeScript · Vite
