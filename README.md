# FlowHire

Automated job search platform with a uniform data pipeline and open API — built for humans and AI agents alike.

## What it does

- **Aggregates jobs** from USAJobs (federal: EPA, USGS, DOE, NOAA), Greenhouse, and Lever into a single normalized schema
- **Open REST API** — CORS-open, machine-readable, fully documented at `/api/docs`
- **AI-powered** — Claude Opus 4.7 scores jobs against your resume, extracts requirements, and parses natural language searches
- **Web portal** — search, filter, and manually add job postings via a React UI
- **BYOK** — bring your own Anthropic API key per request, or set it server-side

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
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | AI scoring (optional — can BYOK per request) |

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

## Key API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/jobs` | List/search jobs (`?q=`, `?remote=true`, `?source=usajobs`) |
| `GET` | `/api/jobs/{id}` | Job detail |
| `POST` | `/api/jobs` | Manually add a job posting |
| `POST` | `/api/ingest/all` | Run all configured sources |
| `POST` | `/api/ai/analyze` | Score a job vs resume (Claude Opus 4.7) |
| `POST` | `/api/ai/search` | Natural language job search |
| `GET` | `/api/stats` | DB summary stats |

## Adding sources

Edit `backend/sources_config.py` to add new USAJobs searches or Greenhouse/Lever company slugs — no code changes needed.

## Stack

- **Backend:** Python · FastAPI · SQLAlchemy · SQLite · httpx
- **AI:** Anthropic SDK · Claude Opus 4.7 · prompt caching
- **Sources:** USAJobs API · Greenhouse Jobs API · Lever Postings API
- **Frontend:** React · TypeScript · Vite
