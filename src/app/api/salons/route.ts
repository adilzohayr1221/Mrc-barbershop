import { NextResponse } from 'next/server';
import { listSalons } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Public: active salons only (id, slug, name, city) — used for the salon
// picker on barber self-signup and customer links.
export async function GET() {
  const salons = (await listSalons())
    .filter((s) => s.status === 'active')
    .map((s) => ({ id: s.id, slug: s.slug, name: s.name, city: s.city }));
  return NextResponse.json({ salons });
}
