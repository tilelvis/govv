"""
KE GovVault — shared utilities for all collectors.
HTTP, DB, PDF, time helpers.
"""
from __future__ import annotations

import json
import os
import sys
import hashlib
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
import urllib.request
import urllib.error

import psycopg2
import psycopg2.extras

EAT = timezone(timedelta(hours=3))

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
REPORTS_DIR = DATA_DIR / "reports"

DATABASE_URL = os.environ.get("DATABASE_URL")


# ──────────────── Time helpers ────────────────

def now_eat() -> datetime:
    return datetime.now(EAT)

def iso_now() -> str:
    return now_eat().isoformat()

def today_str() -> str:
    return now_eat().strftime("%Y-%m-%d")

def week_monday_str() -> str:
    now = now_eat()
    monday = now - timedelta(days=now.weekday())
    return monday.strftime("%Y-%m-%d")


# ──────────────── HTTP helpers ────────────────

UA = "KE-GovVault/1.0 (+https://github.com/bizwonda/ke-govvault)"

def fetch_json(url: str, headers: dict | None = None, timeout: int = 15):
    req = urllib.request.Request(url, headers={**{"User-Agent": UA}, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f"  ⚠ {url.split('?')[0]}: {e}", file=sys.stderr)
        return None

def fetch_text(url: str, headers: dict | None = None, timeout: int = 30) -> str | None:
    req = urllib.request.Request(url, headers={**{"User-Agent": UA}, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode(errors="replace")
    except Exception as e:
        print(f"  ⚠ {url.split('?')[0]}: {e}", file=sys.stderr)
        return None

def fetch_bytes(url: str, headers: dict | None = None, timeout: int = 60) -> bytes | None:
    """Download raw bytes (for PDFs)."""
    req = urllib.request.Request(url, headers={**{"User-Agent": UA}, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception as e:
        print(f"  ⚠ {url.split('?')[0]}: {e}", file=sys.stderr)
        return None

def strip_html(html: str) -> str:
    html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)
    html = re.sub(r"<[^>]+>", " ", html)
    html = re.sub(r"\s+", " ", html)
    return html.strip()


# ──────────────── Database helpers ────────────────

def db_connect():
    if not DATABASE_URL:
        print("  ✗ DATABASE_URL is not set. Export it or add it as a GitHub Actions secret.", file=sys.stderr)
        sys.exit(1)
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return conn

def db_insert(conn, table: str, row: dict) -> int:
    cols = list(row.keys())
    placeholders = ",".join(["%s"] * len(cols))
    sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders}) RETURNING id"
    with conn.cursor() as cur:
        cur.execute(sql, [row[c] for c in cols])
        new_id = cur.fetchone()["id"]
    return new_id

def db_insertmany(conn, table: str, rows: list[dict]):
    if not rows:
        return 0
    cols = list(rows[0].keys())
    placeholders = ",".join(["%s"] * len(cols))
    sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders})"
    with conn.cursor() as cur:
        cur.executemany(sql, [[r[c] for c in cols] for r in rows])
    return len(rows)


# ──────────────── PDF helpers ────────────────

def pdf_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def pdf_text(data: bytes, max_pages: int = 200) -> tuple[str, int]:
    """
    Extract text from PDF bytes using PyMuPDF.
    Returns (text, page_count).
    Falls back to empty string if PyMuPDF is not installed.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        print("  ⚠ PyMuPDF not installed. Run: pip install PyMuPDF", file=sys.stderr)
        return "", 0

    doc = fitz.open(stream=data, filetype="pdf")
    page_count = min(doc.page_count, max_pages)
    text_parts = []
    for i in range(page_count):
        page = doc[i]
        text_parts.append(page.get_text())
    doc.close()
    return "\n".join(text_parts), page_count

def smart_truncate(text: str, max_chars: int = 500_000) -> str:
    """Truncate to max_chars at a word boundary."""
    if len(text) <= max_chars:
        return text
    truncated = text[:max_chars]
    # Find last space
    last_space = truncated.rfind(" ")
    if last_space > max_chars - 200:
        truncated = truncated[:last_space]
    return truncated + "\n\n[... truncated]"


# ──────────────── JSON snapshot helpers ────────────────

def save_report(module: str, payload: dict, name_prefix: str = "") -> dict[str, str]:
    out_dir = REPORTS_DIR / module
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = now_eat().strftime("%Y-%m-%d_%H%M")
    json_name = f"{name_prefix}{ts}.json" if name_prefix else f"{ts}.json"
    json_path = out_dir / json_name
    json_path.write_text(json.dumps(payload, indent=2, default=str))
    latest_json = out_dir / "latest.json"
    latest_json.write_text(json.dumps(payload, indent=2, default=str))
    return {"json": str(json_path), "latest_json": str(latest_json)}

def load_latest(module: str) -> dict | None:
    p = REPORTS_DIR / module / "latest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text())


# ──────────────── Collection run tracker ────────────────

def start_run(conn, source: str) -> int:
    """Create a collection_runs row and return its ID."""
    return db_insert(conn, "collection_runs", {
        "source": source,
        "started_at": iso_now(),
        "status": "running",
        "documents_found": 0,
        "documents_new": 0,
    })

def finish_run(conn, run_id: int, status: str, found: int, new: int, errors: str = ""):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE collection_runs SET finished_at = %s, status = %s, documents_found = %s, documents_new = %s, errors = %s WHERE id = %s",
            [iso_now(), status, found, new, errors[:2000], run_id],
        )
    conn.commit()


# ──────────────── Misc ────────────────

def safe_str(s, max_len: int = 500) -> str:
    if s is None:
        return ""
    s = str(s).strip()
    return s[:max_len]

def to_float(s, default=None):
    if s is None:
        return default
    try:
        if isinstance(s, str):
            s = s.replace(",", "").replace("KES", "").replace("USD", "").strip()
        return float(s)
    except (ValueError, TypeError):
        return default