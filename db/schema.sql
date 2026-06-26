-- KE GovVault — PostgreSQL schema
-- Shared by Python collectors (writes) and the Next.js dashboard (reads).
-- Requires: PostgreSQL 14+ with pgvector extension.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ──────────────── Documents (core table) ────────────────
CREATE TABLE IF NOT EXISTS documents (
  id              SERIAL PRIMARY KEY,
  source          TEXT NOT NULL,                -- gazette, court_ruling, hansard, cbk_circular, knbs_report, budget, tender, cma_notice
  title           TEXT NOT NULL,
  description     TEXT,                         -- Brief summary or first paragraph
  content         TEXT,                         -- Full extracted text
  content_tsv     TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED,
  pdf_url         TEXT,                         -- Original download URL
  pdf_storage_key TEXT,                         -- R2/S3 storage key for archived PDF
  published_date  DATE,                         -- Date on the document
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  page_count      INTEGER,
  file_size_bytes INTEGER,
  file_hash       TEXT,                         -- SHA-256 of the PDF for dedup
  metadata_json   JSONB DEFAULT '{}',           -- Source-specific metadata
  ai_summary      TEXT,                         -- GLM-generated summary
  ai_topics       TEXT[],                       -- Auto-classified topic tags
  ai_entities     JSONB DEFAULT '[]',           -- [{type, name, count}, ...]
  is_processed    BOOLEAN NOT NULL DEFAULT FALSE -- Whether AI extraction has run
);

-- Full-text search index (GIN for tsvector)
CREATE INDEX IF NOT EXISTS idx_documents_tsv ON documents USING GIN (content_tsv);
-- Source + date index
CREATE INDEX IF NOT EXISTS idx_documents_source_date ON documents (source, published_date DESC);
-- Fetch time index
CREATE INDEX IF NOT EXISTS idx_documents_fetched ON documents (fetched_at DESC);
-- File hash for dedup
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents (file_hash);
-- Trigram index for fast LIKE/ILIKE substring search
CREATE INDEX IF NOT EXISTS idx_documents_content_trgm ON documents USING GIN (content gin_trgm_ops);

-- ──────────────── Entities (extracted NER) ────────────────
CREATE TABLE IF NOT EXISTS entities (
  id              SERIAL PRIMARY KEY,
  entity_type     TEXT NOT NULL,                -- person, organization, location, amount, date, law, citation
  name            TEXT NOT NULL,
  normalized_name TEXT,                         -- Lowercase, stripped for grouping
  document_id     INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  count           INTEGER NOT NULL DEFAULT 1,
  first_seen      DATE NOT NULL DEFAULT CURRENT_DATE,
  metadata_json   JSONB DEFAULT '{}'            -- e.g. {amount_kes: 5000000, currency: "KES"}
);

CREATE INDEX IF NOT EXISTS idx_entities_type_name ON entities (entity_type, normalized_name);
CREATE INDEX IF NOT EXISTS idx_entities_doc ON entities (document_id);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities USING GIN (normalized_name gin_trgm_ops);

-- ──────────────── Collection Runs (tracking) ────────────────
CREATE TABLE IF NOT EXISTS collection_runs (
  id              SERIAL PRIMARY KEY,
  source          TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running',  -- running, success, error
  documents_found INTEGER NOT NULL DEFAULT 0,
  documents_new   INTEGER NOT NULL DEFAULT 0,
  errors          TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_source ON collection_runs (source, started_at DESC);

-- ──────────────── Alerts ────────────────
CREATE TABLE IF NOT EXISTS alert_rules (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  source          TEXT,                         -- Filter by document source (null = all)
  keyword         TEXT,                         -- Alert when this keyword appears in new docs
  entity_name     TEXT,                         -- Or alert when this entity appears
  channel         TEXT NOT NULL DEFAULT 'telegram',
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_fired      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS alerts_log (
  id              SERIAL PRIMARY KEY,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rule_id         INTEGER REFERENCES alert_rules(id),
  channel         TEXT NOT NULL,
  document_id     INTEGER REFERENCES documents(id),
  subject         TEXT,
  body            TEXT,
  status          TEXT,                         -- sent, failed, skipped
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_log_time ON alerts_log (sent_at DESC);