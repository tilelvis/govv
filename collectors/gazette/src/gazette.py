"""
Kenya Gazette Collector
========================
Scrapes Kenya Law gazette listings, downloads PDFs,
extracts full text, and stores everything in PostgreSQL.

Kenya Law gazette page: https://kenyalaw.org/gazette/
Each gazette supplement is a downloadable PDF.
"""
import sys, os, re, json
from pathlib import Path
from datetime import datetime, date

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _common import (
    fetch_text, fetch_bytes, pdf_hash, pdf_text, smart_truncate,
    db_connect, db_insert, save_report, iso_now, today_str, now_eat,
    start_run, finish_run, safe_str, strip_html, REPO_ROOT,
)


GAZETTE_LIST_URL = "https://kenyalaw.org/gazette/"
MAX_GAZETTES = 20  # Process at most this many per run (most recent first)
MAX_PDF_MB = 100   # Skip PDFs larger than this


def parse_gazette_list(html: str) -> list[dict]:
    """
    Parse the gazette listing page and extract individual gazette entries.
    Returns list of {title, url, date, notice_type}.
    """
    gazettes = []

    # Pattern 1: Look for links to gazette supplements
    # Kenya Law typically has links like /gazette/notice/YYYY/number/
    # or direct PDF links

    # Find all links that might be gazette PDFs or gazette pages
    # Common patterns on Kenya Law:
    # - href="/Gazettes/.../Kenya-Gazette-Supplement-....pdf"
    # - href with "gazette" in the path containing .pdf
    pdf_links = re.findall(
        r'href=["\']([^"\']*(?:gazette|Gazette|GAZETTE)[^"\']*(?:\.pdf)[^"\']*)["\']',
        html, re.IGNORECASE
    )

    # Also find supplement/notice links
    notice_links = re.findall(
        r'href=["\']([^"\']*(?:/gazette/|/Gazettes/)[^"\']+)["\']',
        html, re.IGNORECASE
    )

    # Deduplicate
    seen_urls = set()
    all_links = pdf_links + notice_links

    for link in all_links:
        # Normalize URL
        if link.startswith("/"):
            link = "https://kenyalaw.org" + link

        if link in seen_urls:
            continue
        seen_urls.add(link)

        # Extract title from URL or nearby text
        title = _extract_title_from_url(link)

        # Extract date if present in URL
        pub_date = _extract_date_from_url(link)

        gazettes.append({
            "title": title,
            "url": link,
            "published_date": pub_date,
            "notice_type": "supplement" if "supplement" in link.lower() else "gazette",
        })

    # If no gazette-specific links found, try a broader approach
    if not gazettes:
        gazettes = _fallback_parse(html)

    return gazettes


def _extract_title_from_url(url: str) -> str:
    """Generate a readable title from a gazette URL."""
    # Try to extract filename
    filename = url.split("/")[-1]
    if filename.endswith(".pdf"):
        # Replace hyphens and underscores with spaces, remove extension
        name = filename[:-4].replace("-", " ").replace("_", " ")
        # Title case it
        return name.strip().title() or "Kenya Gazette"
    # Extract from path segments
    segments = [s for s in url.split("/") if s and s not in ("gazette", "Gazettes", "notice", "supplement")]
    if segments:
        return f"Kenya Gazette - {segments[-1].replace('-', ' ').title()}"
    return "Kenya Gazette"


def _extract_date_from_url(url: str) -> str | None:
    """Try to extract a date (YYYY-MM-DD) from the URL."""
    # Look for year patterns
    year_match = re.search(r'(20\d{2})', url)
    month_match = re.search(r'(0[1-9]|1[0-2])', url)
    day_match = re.search(r'(0[1-9]|[12]\d|3[01])', url)

    if year_match:
        y = year_match.group(1)
        m = month_match.group(1) if month_match else "01"
        d = day_match.group(1) if day_match else "01"
        try:
            date_obj = date(int(y), int(m), int(d))
            return date_obj.isoformat()
        except ValueError:
            pass
    return None


def _fallback_parse(html: str) -> list[dict]:
    """
    Fallback parser: find all PDF links on the page that look like government documents.
    """
    gazettes = []
    # Find ALL PDF links
    pdf_links = re.findall(r'href=["\']([^"\']*\.pdf[^"\']*)["\']', html, re.IGNORECASE)
    seen = set()
    for link in pdf_links:
        if link.startswith("/"):
            link = "https://kenyalaw.org" + link
        if link not in seen:
            seen.add(link)
            title = _extract_title_from_url(link)
            gazettes.append({
                "title": title,
                "url": link,
                "published_date": _extract_date_from_url(link),
                "notice_type": "pdf",
            })
    return gazettes


def process_gazette(conn, gazette: dict) -> dict:
    """
    Download a single gazette PDF, extract text, and store in DB.
    Returns {status, doc_id, error, pages, size}.
    """
    url = gazette["url"]
    print(f"    → {gazette['title'][:80]}")

    # Download PDF
    pdf_bytes = fetch_bytes(url)
    if not pdf_bytes:
        return {"status": "error", "error": "download_failed"}
    if len(pdf_bytes) > MAX_PDF_MB * 1024 * 1024:
        return {"status": "error", "error": f"too_large ({len(pdf_bytes) / 1024 / 1024:.1f}MB)"}

    # Check for duplicates via hash
    file_hash = pdf_hash(pdf_bytes)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM documents WHERE file_hash = %s LIMIT 1", [file_hash])
        existing = cur.fetchone()
    if existing:
        print(f"      ⏭️  Duplicate (id={existing['id']})")
        return {"status": "duplicate", "doc_id": existing["id"]}

    # Extract text from PDF
    text, page_count = pdf_text(pdf_bytes)
    text = smart_truncate(text)

    # Generate description (first 500 chars of text)
    description = text[:500].strip() if text else None

    # Parse published date
    pub_date = gazette.get("published_date")
    if pub_date:
        try:
            pub_date = datetime.strptime(pub_date, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            pub_date = today_str()
    else:
        pub_date = today_str()

    # Try to extract date from the PDF text itself
    if text and not gazette.get("published_date"):
        # Look for "KENYA GAZETTE SUPPLEMENT" followed by date
        date_match = re.search(
            r'(?:GAZETTE|Gazette|REPUBLIC\s+OF\s+KENYA)[^\n]*?(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+,?\s*\d{4})',
            text[:2000]
        )
        if date_match:
            try:
                from dateutil import parser as dparser
                pub_date = dparser.parse(date_match.group(1)).date()
            except Exception:
                pass

    # Insert into database
    doc_id = db_insert(conn, "documents", {
        "source": "gazette",
        "title": safe_str(gazette["title"], 500),
        "description": safe_str(description, 1000),
        "content": text,
        "pdf_url": url,
        "published_date": pub_date,
        "fetched_at": iso_now(),
        "page_count": page_count,
        "file_size_bytes": len(pdf_bytes),
        "file_hash": file_hash,
        "metadata_json": json.dumps({
            "notice_type": gazette.get("notice_type", ""),
            "collector": "gazette_v1",
        }),
        "is_processed": False,
    })

    print(f"      ✅ Saved (id={doc_id}, {page_count} pages, {len(pdf_bytes)/1024:.0f}KB)")
    return {"status": "new", "doc_id": doc_id, "pages": page_count, "size": len(pdf_bytes)}


def main():
    print("📜 Kenya Gazette Collector — starting...")
    conn = db_connect()
    run_id = start_run(conn, "gazette")

    # Fetch the gazette listing page
    print("  📡 Fetching gazette listing...")
    html = fetch_text(GAZETTE_LIST_URL)
    if not html:
        print("  ❌ Failed to fetch gazette listing page")
        finish_run(conn, run_id, "error", 0, 0, "Failed to fetch listing page")
        conn.close()
        return

    # Parse available gazettes
    gazettes = parse_gazette_list(html)
    print(f"  📋 Found {len(gazettes)} gazette links")

    if not gazettes:
        # Try alternative: Kenya Law Gazette archive page
        print("  📡 Trying alternative archive URL...")
        alt_url = "https://kenyalaw.org/gazette/notice/"
        alt_html = fetch_text(alt_url)
        if alt_html:
            gazettes = parse_gazette_list(alt_html)
            print(f"  📋 Found {len(gazettes)} gazette links (alternative)")

    # Limit to most recent
    gazettes = gazettes[:MAX_GAZETTES]

    # Process each gazette
    found = len(gazettes)
    new_count = 0
    errors = []

    for i, gaz in enumerate(gazettes, 1):
        print(f"  [{i}/{len(gazettes)}] {gaz['title'][:60]}")
        try:
            result = process_gazette(conn, gaz)
            if result["status"] == "new":
                new_count += 1
            elif result["status"] == "error":
                errors.append(f"{gaz['title'][:50]}: {result.get('error', 'unknown')}")
        except Exception as e:
            print(f"      ❌ {e}")
            errors.append(f"{gaz['title'][:50]}: {str(e)[:100]}")

    conn.commit()
    conn.close()

    # Save report
    report = {
        "date": today_str(),
        "generated_at": iso_now(),
        "source": "gazette",
        "found": found,
        "new": new_count,
        "errors": errors,
        "gazettes_processed": [
            {"title": g["title"], "url": g["url"], "date": g.get("published_date")}
            for g in gazettes
        ],
    }
    save_report("gazette", report, name_prefix="gaz_")
    finish_run(conn if conn.closed else db_connect(), run_id, "success", found, new_count, "; ".join(errors[:5]))

    print(f"\n{'='*50}")
    print(f"📜 Gazette: {found} found, {new_count} new, {len(errors)} errors")
    if errors:
        print(f"   Errors: {'; '.join(errors[:3])}")


if __name__ == "__main__":
    main()