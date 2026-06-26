/**
 * GET /api/stats — dashboard statistics
 */
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const total = await db.document.count();
    const processed = await db.document.count({ where: { isProcessed: true } });

    // @ts-expect-error
    const bySource: { source: string; count: number }[] = await db.$queryRaw(Prisma.sql`
      SELECT source, COUNT(*)::int as count FROM documents GROUP BY source ORDER BY count DESC
    `);

    // @ts-expect-error
    const byMonth: { month: string; count: number }[] = await db.$queryRaw(Prisma.sql`
      SELECT TO_CHAR(published_date, 'YYYY-MM') as month, COUNT(*)::int as count
      FROM documents WHERE published_date >= NOW() - INTERVAL '12 months'
      GROUP BY month ORDER BY month
    `);

    // @ts-expect-error
    const [{ totalPages }]: { totalPages: number }[] = await db.$queryRaw(Prisma.sql`
      SELECT COALESCE(SUM(page_count), 0)::int as "totalPages" FROM documents
    `);

    // @ts-expect-error
    const [{ totalTextMb }]: { totalTextMb: string }[] = await db.$queryRaw(Prisma.sql`
      SELECT COALESCE(ROUND(SUM(LENGTH(content))::numeric / 1048576, 1), 0)::text as "totalTextMb" FROM documents
    `);

    // @ts-expect-error
    const topEntities: { entity_type: string; name: string; doc_count: number }[] = await db.$queryRaw(Prisma.sql`
      SELECT entity_type, name, COUNT(DISTINCT document_id)::int as "doc_count"
      FROM entities GROUP BY entity_type, name ORDER BY "doc_count" DESC LIMIT 30
    `);

    const recentRuns = await db.collectionRun.findMany({
      orderBy: [{ startedAt: 'desc' }], take: 10,
    });

    const recentDocs = await db.document.findMany({
      orderBy: [{ fetchedAt: 'desc' }], take: 5,
      select: { id: true, source: true, title: true, publishedDate: true, fetchedAt: true, pageCount: true, aiSummary: true, aiTopics: true },
    });

    return NextResponse.json({
      total, processed, totalPages,
      totalTextMb: parseFloat(totalTextMb || '0'),
      bySource, byMonth,
      topEntities,
      recentRuns,
      recentDocs,
    });
  } catch (e: any) {
    console.error('[stats]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}