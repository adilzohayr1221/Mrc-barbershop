import { NextResponse } from 'next/server';
import { listReviews } from '@/lib/store';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Owner-only: list all reviews (for moderation).
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ reviews: await listReviews() });
}
