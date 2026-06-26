"""
KE GovVault — AI Entity & Topic Extraction
============================================
Reads unprocessed documents, sends content to GLM for:
  - Named Entity Recognition (people, orgs, locations, amounts, dates)
  - Topic classification
  - Summary generation
  - Key phrase extraction

Updates the document row and populates the entities table.
"""
import sys, os, json, subprocess, textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "collectors"))

from _common import (
    iso_now, now_eat, today_str,
    db_connect, db_insert, db_insertmany,
    REPO_ROOT,
)

NODE_HELPER = REPO_ROOT / "ai" / "src" / "zai_call.mjs"
NODE_PROJECT_DIR = REPO_ROOT / "web"


def call_zai(system: str, user: str, temperature: float = 0.3, max_tokens: int = 2000) -> dict:
    """Invoke GLM via the Node helper. Returns {response, model, tokens_used}."""
    if not NODE_HELPER.exists():
        return {"response": "", "model": "", "tokens_used": 0, "error": "zai_call.mjs not found"}

    payload = json.dumps({"system": system, "user": user, "temperature": temperature, "max_tokens": max_tokens})
    try:
        result = subprocess.run(
            ["node", str(NODE_HELPER)],
            input=payload, capture_output=True, text=True, timeout=120,
            cwd=str(NODE_PROJECT_DIR),
        )
        if result.returncode != 0:
            return {"response": "", "model": "", "tokens_used": 0, "error": result.stderr.strip()[:500]}
        return json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        return {"response": "", "model": "", "tokens_used": 0, "error": "timeout"}
    except Exception as e:
        return {"response": "", "model": "", "tokens_used": 0, "error": str(e)}


def extract_from_document(content: str, title: str, source: str) -> dict:
    """
    Send document content to GLM for entity extraction and summarization.
    Returns parsed JSON with entities, topics, summary, key_phrases.
    """
    # Truncate content to fit context window (~8000 chars)
    doc_text = content[:8000] if content else ""

    system = textwrap.dedent("""\
        You are a Kenyan government document analyst. Analyze the document below and return ONLY valid JSON (no markdown, no code fences) with this exact structure:
        {
            "summary": "2-3 sentence summary of the document's key points",
            "topics": ["topic1", "topic2", "topic3"],
            "entities": [
                {"type": "person", "name": "Full Name", "count": 2},
                {"type": "organization", "name": "Org Name", "count": 1},
                {"type": "location", "name": "Place Name", "count": 3},
                {"type": "amount", "name": "KES 5,000,000", "count": 1, "metadata": {"value": 5000000, "currency": "KES"}},
                {"type": "date", "name": "15 January 2026", "count": 1},
                {"type": "law", "name": "Act Name", "count": 1},
                {"type": "citation", "name": "Case reference", "count": 1}
            ],
            "key_phrases": ["phrase1", "phrase2", "phrase3"]
        }

        Entity types to extract:
        - person: People named (officials, judges, parties)
        - organization: Government bodies, companies, institutions
        - location: Places, counties, regions, addresses
        - amount: Monetary values with currency
        - date: Significant dates mentioned
        - law: Acts, bills, regulations referenced
        - citation: Legal case citations

        Return ONLY the JSON object. No explanation.""")

    user = f"Document title: {title}\nSource: {source}\n\n---\n{doc_text}\n---\n\nAnalyze this document."

    result = call_zai(system, user, temperature=0.2, max_tokens=2000)

    if result.get("error"):
        return {"error": result["error"], "entities": [], "topics": [], "summary": "", "key_phrases": []}

    response_text = result.get("response", "").strip()

    # Parse the JSON response
    try:
        # Handle case where model wraps in ```json ... ```
        cleaned = response_text
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
        parsed = json.loads(cleaned)
        return {
            "summary": parsed.get("summary", ""),
            "topics": parsed.get("topics", []),
            "entities": parsed.get("entities", []),
            "key_phrases": parsed.get("key_phrases", []),
            "model": result.get("model", ""),
            "tokens_used": result.get("tokens_used", 0),
        }
    except json.JSONDecodeError as e:
        return {"error": f"JSON parse error: {e}", "entities": [], "topics": [], "summary": response_text[:500], "key_phrases": []}


def process_document(conn, doc: dict) -> dict:
    """Process a single document: extract entities, update DB."""
    doc_id = doc["id"]
    content = doc.get("content") or ""
    title = doc.get("title") or ""

    if not content or len(content.strip()) < 50:
        # Not enough text to analyze
        with conn.cursor() as cur:
            cur.execute("UPDATE documents SET is_processed = TRUE WHERE id = %s", [doc_id])
        return {"status": "skipped", "reason": "insufficient_content"}

    print(f"  → Doc #{doc_id}: {title[:60]}")

    result = extract_from_document(content, title, doc.get("source", ""))

    # Update the document row
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE documents SET
                ai_summary = %s,
                ai_topics = %s,
                ai_entities = %s,
                is_processed = TRUE
               WHERE id = %s""",
            [
                result.get("summary", "")[:2000],
                result.get("topics", []),
                json.dumps(result.get("entities", [])),
                doc_id,
            ],
        )

    # Insert entities into the entities table
    entities = result.get("entities", [])
    if entities:
        today = today_str()
        rows = []
        for ent in entities:
            name = ent.get("name", "").strip()
            if not name:
                continue
            rows.append({
                "entity_type": ent.get("type", "unknown"),
                "name": name,
                "normalized_name": name.lower().strip(),
                "document_id": doc_id,
                "count": ent.get("count", 1),
                "first_seen": today,
                "metadata_json": json.dumps(ent.get("metadata", {})),
            })
        if rows:
            db_insertmany(conn, "entities", rows)

    entity_count = len(entities)
    if result.get("error"):
        print(f"    ⚠️  {result['error'][:80]}")
    else:
        print(f"    ✅ {entity_count} entities, topics: {result.get('topics', [])}")

    return {"status": "processed", "entities": entity_count}


def main():
    import re  # ensure available for JSON cleanup
    print("🤖 AI Extraction — processing unprocessed documents...")
    conn = db_connect()

    # Get unprocessed documents, prioritized by most recent
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, source, title, content, published_date
            FROM documents
            WHERE is_processed = FALSE AND content IS NOT NULL AND LENGTH(content) > 50
            ORDER BY fetched_at DESC
            LIMIT 10
        """)
        docs = cur.fetchall()

    print(f"  📋 Found {len(docs)} documents to process")

    if not docs:
        print("  ✓ Nothing to process")
        conn.close()
        return

    processed = 0
    errors = 0
    for doc in docs:
        try:
            result = process_document(conn, doc)
            if result["status"] == "processed":
                processed += 1
        except Exception as e:
            print(f"    ❌ Error processing doc #{doc['id']}: {e}")
            errors += 1

    conn.commit()
    conn.close()

    print(f"\n{'='*50}")
    print(f"🤖 AI Extraction: {processed} processed, {errors} errors")


if __name__ == "__main__":
    main()