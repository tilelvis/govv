# 🏛️ GovVault

> Full-text searchable archive of Kenya government documents — Gazette notices, court rulings, Hansard debates, budgets, and more — with AI-powered entity extraction and analysis.

## What This Does

Most government intelligence tools store links and metadata. **KE GovVault stores the entire document.** Every Gazette PDF is downloaded, its full text is extracted, and the content is made searchable — word for word.

### Core Features

- **Full PDF text extraction** — downloads gazettes, extracts every word using PyMuPDF
- **PostgreSQL full-text search** — tsvector + ts_rank for relevance-ranked results with highlighted snippets
- **AI entity extraction** — GLM extracts people, organizations, locations, amounts, dates, laws, citations from every document
- **AI document summaries** — auto-generated summaries and topic tags
- **AI Q&A** — ask questions about specific documents or the whole corpus
- **Deduplication** — SHA-256 hashing prevents re-processing the same PDF
- **Zero infrastructure cost** — runs on GitHub Actions (free), deploys to Vercel (free), uses Neon Postgres (free tier)

## Architecture

```
GitHub Actions (cron)
    → Python collector runs (daily)
        → Scrapes Kenya Law gazette listings
        → Downloads PDFs
        → Extracts full text with PyMuPDF
        → Stores text + metadata in PostgreSQL
    → AI extraction runs (daily, after collector)
        → Reads unprocessed documents
        → Sends content to GLM for NER + summarization
        → Stores entities, topics, summaries
    → Vercel-hosted Next.js dashboard
        → Full-text search with ranking
        → Document reader with extracted text
        → Entity browser, AI Q&A
```

## Quick Start

### 1. Create a Database

Create a free [Neon](https://neon.tech) PostgreSQL database. You need:
- **Connection string** (pooled, for Vercel)
- **Direct connection string** (unpooled, for Python collectors)

### 2. Initialize the Schema

Run the schema SQL against your database:

```bash
psql $DIRECT_DATABASE_URL < db/schema.sql
```

Or use the Neon SQL editor in their dashboard.

### 3. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/ke-govvault.git
git push -u origin main
```

### 4. Configure GitHub Secrets

In your GitHub repo: **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|--------|-------|
| `DATABASE_URL` | Your Neon **direct** (unpooled) connection string |

### 5. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com), import your GitHub repo
2. Set **Root Directory** to `web`
3. Add environment variables:
   - `DATABASE_URL` = Neon **pooled** connection string (with `?pgbouncer=true`)
4. Deploy

### 6. Run the Collector Manually (optional)

To test before the scheduled cron kicks in:

```bash
# In your GitHub repo → Actions tab → "Gazette Collector" → "Run workflow"

# Or locally:
pip install -r requirements.txt
export DATABASE_URL="your_direct_connection_string"
python collectors/gazette/src/gazette.py

# Then run AI extraction:
cd ai/src && npm install && cd ../..
python ai/src/extract_entities.py
```

### 7. Run the Dashboard Locally (optional)

```bash
cd web
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL
npm install
npm run dev
# Open http://localhost:3000
```

## Schedules

| Workflow | Schedule (EAT) | What |
|----------|----------------|------|
| `gazette-collector.yml` | Daily 4:00 AM | Download + extract gazette PDFs |
| `ai-extraction.yml` | Daily 5:00 AM | Extract entities + summarize |

Both support `workflow_dispatch` for manual runs.

## API Endpoints

All return JSON, no auth required.

| Endpoint | Description |
|----------|-------------|
| `GET /api/documents/latest?source=gazette&limit=20&offset=0` | Recent documents |
| `GET /api/documents/[id]` | Full document + entities |
| `GET /api/search?q=land+transfer&source=gazette&limit=30` | Full-text search with ranking |
| `GET /api/stats` | Dashboard statistics |
| `POST /api/ai/ask` | Ask a question about documents |

## Database Schema

18 tables (core):

- `documents` — full text + metadata + AI fields + tsvector index
- `entities` — extracted named entities (NER) per document
- `collection_runs` — tracks each collector execution
- `alert_rules` / `alerts_log` — future alert system

Key indexes: GIN on `content_tsv` (full-text), GIN trigram on `content` (substring), B-tree on source+date.

## Adding More Sources

To add a new document source (e.g., court rulings):

1. Create `collectors/court_rulings/src/rulings.py` (follow the gazette pattern)
2. Set `source = "court_ruling"` when inserting into the `documents` table
3. Add a GitHub Actions workflow (copy `gazette-collector.yml`, change the script path)
4. The dashboard automatically picks up the new source — no code changes needed

## Extending

- **Semantic search (pgvector)**: Add a `vector(1536)` column, generate embeddings with `sentence-transformers`, query with cosine similarity
- **S3/R2 PDF storage**: Set `pdf_storage_key` when uploading to Cloudflare R2
- **Telegram alerts**: Port the alert system from KE Intelligence
- **Budget parsing**: Use `pdfplumber` to extract tables from budget PDFs into structured data
- **Network graphs**: Query the entities table to build connection graphs between people/orgs

## License

MIT