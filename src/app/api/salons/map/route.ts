import { NextResponse } from 'next/server';
import { listSalons } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Public: approved salons with map coordinates, for the customer map.
// Never exposes owner PII (email/phone).
export async function GET() {
  const salons = await listSalons();
  const pins = salons
    .filter(
      (s) =>
        s.status === 'active' &&
        typeof s.lat === 'number' &&
        typeof s.lng === 'number' &&
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lng)
    )
    .map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      address: s.address ?? '',
      city: s.city,
      lat: s.lat as number,
      lng: s.lng as number,
    }));
  return NextResponse.json({ salons: pins });
}
