# OfferLoops

**Close the loop on your job search** — aggregate postings, score them with AI, and generate tailored application materials, all in one open pipeline.

OfferLoops is an open-source job search platform that turns the fragmented job hunt into a repeatable system: ingest from multiple sources, rank every posting against your profile in bulk, then generate a tailored resume and cover letter in one click. The REST API is fully open so AI agents can drive the entire loop autonomously.

## The loop

```
Discover → Score → Apply → Track
```

| Stage | What happens |
|-------|-------------|
| **Discover** | Pull jobs from USAJobs (federal agencies), Greenhouse, Lever, Ashby, Idealist, ClimateBase, and 80k Hours into a single normalized schema |
| **Score** | Bulk-score every unscored job against your saved profile resume — streamed in real time, up to 10 parallel AI calls |
| **Apply** | Generate a tailored resume + cover letter for any job in one API call |
| **Track** | Search, filter, and manage your pipeline through the web UI or REST API |

## Features

- **Multi-source ingestion** — USAJobs (EPA, USGS, NOAA, DOE), Greenhouse, Lever, Ashby, Idealist, ClimateBase, 80,000 Hours
- **Bulk AI scoring** — `POST /api/ai/score-all` streams SSE progress as each job is scored concurrently
- **Application pack** — one call produces a tailored resume + cover letter for any posting
- **Multi-model AI** — Anthropic Claude, OpenAI GPT-4o, NVIDIA NIM (Llama), Google Gemini; swap per request
- **BYOK** — bring your own API key per request, or configure server-side
- **Open REST API** — CORS-open, fully documented at `/api/docs`; AI agents can drive the full loop
- **Profile import** — upload PDF/DOCX/TXT resume, paste text, or import from LinkedIn URL
- **Gmail integration** — detect recruiter emails and track application status

## Quickstart

```bash
# 1. Copy and fill in your API keys
cp .env.example .env

# 2. Install Python dependencies
uv venv .venv && uv pip install --python .venv/bin/python -r backend/requirements.txt

# 3. Install frontend dependencies
cd frontend && npm install && cd ..

# 4. Start both servers
./start.sh
```

Web portal: http://localhost:5173  
API docs: http://localhost:8000/api/docs

## API keys

| Key | Where to get it | Required for |
|-----|----------------|--------------|
| `USAJOBS_API_KEY` | [developer.usajobs.gov](https://developer.usajobs.gov/APIRequest/Index) | Federal job import |
| `USAJOBS_USER_AGENT` | Your email address | Required with above |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Claude (optional — BYOK per request) |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | GPT-4o (optional) |
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) | NVIDIA NIM / Llama (optional, free tier) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) | Gemini (optional) |
| `JWT_SECRET` | `openssl rand -hex 32` | Auth (required in production) |

## Importing jobs

```bash
# Run all configured sources
curl -X POST http://localhost:8000/api/ingest/all

# Federal jobs by keyword
curl -X POST "http://localhost:8000/api/ingest/usajobs?keyword=water+quality&pages=2"

# Specific Greenhouse company
curl -X POST http://localhost:8000/api/ingest/greenhouse/watershed

# Specific Lever company
curl -X POST http://localhost:8000/api/ingest/lever/erg
```

## Bulk AI scoring

Score all unscored jobs in one call. The endpoint streams SSE progress events as each job is scored.

```bash
# Score all unscored jobs (server-side key)
curl -X POST "http://localhost:8000/api/ai/score-all?provider=anthropic"

# Re-score everything, 5 concurrent calls, BYOK
curl -X POST "http://localhost:8000/api/ai/score-all?provider=anthropic&rescore=true&concurrency=5&api_key=sk-ant-..."
```

SSE event types: `start` · `progress` (job_id, title, score) · `error` · `done`

Or use the **⚡ Score All** button in the web portal for a live progress panel.

## Key API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/jobs` | List/search jobs (`?q=`, `?remote=true`, `?source=usajobs`, `?min_score=3.5`) |
| `GET` | `/api/jobs/{id}` | Job detail |
| `POST` | `/api/jobs` | Manually add a posting |
| `POST` | `/api/ingest/all` | Run all configured sources |
| `POST` | `/api/ai/score-all` | Bulk score all jobs vs profile resume (SSE) |
| `POST` | `/api/ai/analyze` | Score a single job vs resume |
| `POST` | `/api/ai/application-pack` | Generate tailored resume + cover letter |
| `POST` | `/api/ai/search` | Natural language job search |
| `GET` | `/api/ai/providers` | List available AI providers |
| `GET/POST` | `/api/profile` | Get or save profile |
| `POST` | `/api/profile/upload` | Upload resume (PDF/DOCX/TXT) |
| `POST` | `/api/profile/linkedin` | Import from LinkedIn URL |
| `GET` | `/api/stats` | Database summary stats |

## Adding sources

Edit `backend/sources_config.py` to add USAJobs keyword searches or Greenhouse/Lever/Ashby company slugs — no code changes needed.

## Stack

- **Backend:** Python · FastAPI · SQLAlchemy · SQLite · httpx
- **AI:** Anthropic SDK · OpenAI SDK · NVIDIA NIM · Google Gemini · prompt caching
- **Sources:** USAJobs API · Greenhouse · Lever · Ashby · Idealist · ClimateBase · 80k Hours
- **Frontend:** React · TypeScript · Vite
- **Deploy:** Docker · Railway

## License

MIT
