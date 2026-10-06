import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getLeaderboard } from '@/lib/leaderboard';
import { PLATFORM_SALON_ID } from '@/lib/types';

/** Monthly barber leaderboard. Super-admin; optional ?salon=<id> to view a client salon. */
export async function GET(req: Request) {
  if (!requireOwner(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const salonId = searchParams.get('salon') || PLATFORM_SALON_ID;
  const data = await getLeaderboard(salonId);
  return NextResponse.json(data);
}
