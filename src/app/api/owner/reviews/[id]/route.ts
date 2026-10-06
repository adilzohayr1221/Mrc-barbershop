import { NextResponse } from 'next/server';
import { getReview, saveReview, deleteReview } from '@/lib/store';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Owner-only: edit a review's text/rating.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const review = await getReview(id);
  if (!review) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (body?.text !== undefined) {
    const text = String(body.text).trim();
    if (text.length < 2 || text.length > 1000) return NextResponse.json({ error: 'Invalid text' }, { status: 400 });
    review.text = text;
  }
  if (body?.rating !== undefined) {
    if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5)
      return NextResponse.json({ error: 'Invalid rating' }, { status: 400 });
    review.rating = body.rating;
  }
  await saveReview(review);
  return NextResponse.json({ review });
}

// Owner-only: delete a review.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await deleteReview(id);
  return NextResponse.json({ ok: true });
}
