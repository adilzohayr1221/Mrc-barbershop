import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { getBarbers } from '@/lib/store';
import { getLeaderboard } from '@/lib/leaderboard';
import { PLATFORM_SALON_ID } from '@/lib/types';

/** Monthly barber leaderboard, scoped to the barber's own salon. Read-only. */
export async function GET(req: Request) {
  const s = requireBarber(req);
  if (!s || !s.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const barbers = await getBarbers();
  const me = barbers.find((b) => b.id === s.barberId);
  const salonId = me?.salonId || s.salonId || PLATFORM_SALON_ID;
  const data = await getLeaderboard(salonId);
  return NextResponse.json(data);
}
