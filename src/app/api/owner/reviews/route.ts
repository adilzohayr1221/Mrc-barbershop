import { NextResponse } from 'next/server';
import { listReviews } from '@/lib/store';

import { requireActiveOwner } from "@/lib/guard";

export const dynamic = 'force-dynamic';

// Owner-only: list all reviews (for moderation).
export async function GET(req: Request) {
  if (!(await requireActiveOwner(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ reviews: await listReviews() });
}
