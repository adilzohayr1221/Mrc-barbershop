import { NextResponse } from 'next/server';
import { getBarbers, listReviews, inSalon } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Salon-owner: reviews written about HIS salon's barbers.
export async function GET(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const [barbers, reviews] = await Promise.all([getBarbers(), listReviews()]);
  const myBarberIds = new Set(barbers.filter((b) => inSalon(b, salonId)).map((b) => b.id));
  const barberMap = new Map(barbers.map((b) => [b.id, b.name]));
  const mine = reviews
    .filter((r) => myBarberIds.has(r.barberId))
    .map((r) => ({ ...r, barberName: barberMap.get(r.barberId) ?? '' }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ reviews: mine });
}
