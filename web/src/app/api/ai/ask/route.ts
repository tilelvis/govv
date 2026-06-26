/**
 * POST /api/ai/ask — Ask a question about documents using GLM.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { question, docIds } = await req.json();
    if (!question || question.length < 5) {
      return NextResponse.json({ error: 'Question must be at least 5 characters' }, { status: 400 });
    }

    let documents;
    if (docIds && docIds.length > 0) {
      documents = await db.document.findMany({
        where: { id: { in: docIds } },
        select: { id: true, title: true, content: true, source: true, publishedDate: true },
      });
    } else {
      documents = await db.document.findMany({
        where: { isProcessed: true, aiSummary: { not: null } },
        orderBy: [{ fetchedAt: 'desc' }],
        take: 5,
        select: { id: true, title: true, content: true, source: true, publishedDate: true },
      });
    }

    const context = documents
      .map(d => `[Doc #${d.id}] ${d.title} (${d.source}, ${d.publishedDate?.toISOString().slice(0, 10)}):\n${(d.content || d.aiSummary || '').slice(0, 3000)}`)
      .join('\n\n---\n\n');

    const { ZAI } = await import('z-ai-web-dev-sdk');
    const zai = new ZAI();
    const result = await zai.chat.completions.create({
      model: 'glm-4-flash',
      messages: [
        { role: 'system', content: 'You are a Kenyan government document analyst. Answer based ONLY on the provided excerpts. Cite Doc #ID. Be precise and concise.' },
        { role: 'user', content: `Documents:\n${context}\n\n---\n\nQuestion: ${question}` },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    return NextResponse.json({
      question,
      answer: result.choices?.[0]?.message?.content || 'No response.',
      documentsUsed: documents.map(d => ({ id: d.id, title: d.title, source: d.source })),
      model: result.model,
    });
  } catch (e: any) {
    console.error('[ai/ask]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}