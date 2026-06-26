/**
 * GET /api/search?q=land&source=gazette&limit=50
 * Full-text search using PostgreSQL tsvector with rank and headline.
 * Falls back to ILIKE if tsvector finds nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') || '').trim();
    const source = sp.get('source') || '';
    const limit = Math.min(parseInt(sp.get('limit') || '30', 10), 100);
    const offset = parseInt(sp.get('offset') || '0', 10);

    if (!q || q.length < 2) {
      return NextResponse.json({ error: 'Query must be at least 2 characters', q, results: [], total: 0 });
    }

    const sourceFilter = source && source !== 'all' ? Prisma.raw(`AND d.source = '${source.replace(/'/g, "''")}'`) : Prisma.raw('');

    const tsquery = q.split(/\s+/).filter(w => w.length > 0).map(w => `${w}:*`).join(' & ');

    const searchQuery = Prisma.sql`
      SELECT d.id, d.source, d.title, d.description, d.pdf_url as "pdfUrl",
             d.published_date as "publishedDate", d.fetched_at as "fetchedAt",
             d.page_count as "pageCount", d.file_size_bytes as "fileSizeBytes",
             d.ai_summary as "aiSummary", d.ai_topics as "aiTopics",
             ts_headline(d.content, to_tsquery('english', ${tsquery}), 'MaxWords=60, MinWords=20, MaxFragments=3') as snippet,
             ts_rank(d.content_tsv, to_tsquery('english', ${tsquery})) as rank
      FROM documents d
      WHERE d.content_tsv @@ to_tsquery('english', ${tsquery})
        ${sourceFilter}
      ORDER BY rank DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countQuery = Prisma.sql`
      SELECT COUNT(*)::int as total
      FROM documents d
      WHERE d.content_tsv @@ to_tsquery('english', ${tsquery})
        ${sourceFilter}
    `;

    // @ts-expect-error — raw SQL query
    const results = await db.$queryRaw(searchQuery);
    // @ts-expect-error
    const [{ total }] = await db.$queryRaw(countQuery);

    let finalResults: any[] = results;
    let finalTotal = total;
    let searchType = 'fulltext';

    // Fallback to ILIKE if tsvector finds nothing
    if (total === 0) {
      const likeWhere: Prisma.DocumentWhereInput = source && source !== 'all'
        ? { source, OR: [
            { title: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } },
            { aiSummary: { contains: q, mode: 'insensitive' as const } },
          ]}
        : { OR: [
            { title: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } },
            { aiSummary: { contains: q, mode: 'insensitive' as const } },
          ]};

      const [fbResults, fbTotal] = await Promise.all([
        db.document.findMany({
          where: likeWhere,
          orderBy: [{ fetchedAt: 'desc' }],
          take: limit,
          skip: offset,
          select: {
            id: true, source: true, title: true, description: true,
            pdfUrl: true, publishedDate: true, fetchedAt: true,
            pageCount: true, fileSizeBytes: true, aiSummary: true, aiTopics: true,
          },
        }),
        db.document.count({ where: likeWhere }),
      ]);
      finalResults = fbResults.map(r => ({ ...r, rank: 0, snippet: r.description }));
      finalTotal = fbTotal;
      searchType = 'fallback';
    }

    return NextResponse.json({ q, results: finalResults, total: finalTotal, limit, offset, searchType });
  } catch (e: any) {
    console.error('[search]', e);
    return NextResponse.json({ error: e.message, results: [], total: 0 }, { status: 500 });
  }
}