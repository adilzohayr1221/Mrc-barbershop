import { NextResponse } from 'next/server';
import { sessionSalonId } from '@/lib/auth';
import { requireActiveSalonOwner } from '@/lib/guard';
import { getLeaderboard } from '@/lib/leaderboard';

/** Monthly barber leaderboard, scoped to the salon owner's own salon. */
export async function GET(req: Request) {
  const s = await requireActiveSalonOwner(req);
  if (!s) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const data = await getLeaderboard(sessionSalonId(s));
  return NextResponse.json(data);
}
