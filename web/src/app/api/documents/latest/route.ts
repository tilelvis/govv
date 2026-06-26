/**
 * GET /api/documents/latest?source=gazette&limit=20&offset=0
 * Returns recent documents with optional source filter.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const source = sp.get('source') || '';
    const limit = Math.min(parseInt(sp.get('limit') || '20', 10), 100);
    const offset = parseInt(sp.get('offset') || '0', 10);

    const where: Prisma.DocumentWhereInput = {};
    if (source && source !== 'all') {
      where.source = source;
    }

    const [documents, total] = await Promise.all([
      db.document.findMany({
        where,
        orderBy: [{ fetchedAt: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          source: true,
          title: true,
          description: true,
          pdfUrl: true,
          publishedDate: true,
          fetchedAt: true,
          pageCount: true,
          fileSizeBytes: true,
          aiSummary: true,
          aiTopics: true,
          aiEntities: true,
          isProcessed: true,
        },
      }),
      db.document.count({ where }),
    ]);

    return NextResponse.json({ documents, total, limit, offset });
  } catch (e: any) {
    console.error('[documents/latest]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}