import { NextResponse } from 'next/server';
import { listSalons } from '@/lib/store';
import { hasCoords } from '@/lib/geocode';

export const dynamic = 'force-dynamic';

// Public: approved salons with map coordinates, for the customer map.
// Never exposes owner PII (email/phone).
export async function GET() {
  const salons = await listSalons();
  const pins = salons
    .filter((s) => s.status === 'active' && hasCoords(s))
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
