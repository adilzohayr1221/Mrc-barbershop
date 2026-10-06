import { NextResponse } from 'next/server';
import { getServices, resolveSalon, inSalon } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';

export const dynamic = 'force-dynamic';

// Public: active services only.
export async function GET(req: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(req.url);
  const salonParam = searchParams.get('salon');
  let salonId = 'mrc';
  if (salonParam) {
    const salon = await resolveSalon(salonParam);
    if (!salon) return NextResponse.json({ error: 'Salon not found.' }, { status: 404 });
    salonId = salon.id;
  }
  const services = (await getServices()).filter((s) => s.active && inSalon(s, salonId));
  return NextResponse.json({ services });
}
