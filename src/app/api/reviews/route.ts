import { NextResponse } from 'next/server';
import { listReviews, saveReview, getBarbers, getCustomer, newId } from '@/lib/store';
import { requireCustomer } from '@/lib/auth';
import { ensureSeeded } from '@/lib/seed';
import type { Review } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Public: reviews are customer-visible.
export async function GET(req: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(req.url);
  const barberId = searchParams.get('barberId');
  const reviews = (await listReviews()).filter((r) => !barberId || r.barberId === barberId);
  return NextResponse.json({ reviews });
}

// Customer-written review. Requires a logged-in customer; the name comes from
// the account (never from the client) and each customer keeps a single review
// per barber — resubmitting updates it instead of duplicating.
export async function POST(req: Request) {
  await ensureSeeded();
  const session = requireCustomer(req);
  if (!session || !session.customerId)
    return NextResponse.json({ error: 'Please log in to write a review.' }, { status: 401 });
  const customer = await getCustomer(session.customerId);
  if (!customer) return NextResponse.json({ error: 'Account not found.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { barberId, rating, text } = body ?? {};
  if (typeof barberId !== 'string' || !barberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return NextResponse.json({ error: 'Rating must be 1-5' }, { status: 400 });
  // Text is optional (stars-only reviews are allowed, e.g. from the
  // post-haircut thanks page); when given it must be 2-1000 chars.
  const cleanText = typeof text === 'string' ? text.trim() : '';
  if (cleanText.length === 1 || cleanText.length > 1000)
    return NextResponse.json({ error: 'Please write a few words.' }, { status: 400 });
  const barbers = await getBarbers();
  if (!barbers.some((b) => b.id === barberId && b.active))
    return NextResponse.json({ error: 'Unknown barber' }, { status: 400 });

  const all = await listReviews();
  const existing = all.find((r) => r.barberId === barberId && r.customerId === customer.id);
  const now = new Date().toISOString();
  if (existing) {
    const updated: Review = { ...existing, rating, text: cleanText, createdAt: now };
    await saveReview(updated);
    return NextResponse.json({ review: updated, updated: true });
  }
  const review: Review = {
    id: newId(),
    barberId,
    customerName: customer.name,
    customerId: customer.id,
    rating,
    text: cleanText,
    createdAt: now,
  };
  await saveReview(review);
  return NextResponse.json({ review }, { status: 201 });
}
