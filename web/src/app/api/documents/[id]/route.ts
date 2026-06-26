/**
 * GET /api/documents/[id] — fetch a single document with full content.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const doc = await db.document.findUnique({
      where: { id: parseInt(id, 10) },
    });

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const entities = await db.entity.findMany({
      where: { documentId: doc.id },
      orderBy: [{ count: 'desc' }],
      take: 50,
    });

    return NextResponse.json({ document: doc, entities });
  } catch (e: any) {
    console.error('[documents/id]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}