import { NextResponse } from 'next/server';
import { getPublicBarbers, resolveSalon } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';

export const dynamic = 'force-dynamic';

// Public: active barbers only. No PINs, no customer data.
export async function GET(req: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get('branchId') || undefined;
  const salonParam = searchParams.get('salon');
  let salonId: string | undefined;
  if (salonParam) {
    const salon = await resolveSalon(salonParam);
    if (!salon) return NextResponse.json({ error: 'Salon not found.' }, { status: 404 });
    salonId = salon.id;
  } else {
    salonId = 'mrc';
  }
  const barbers = await getPublicBarbers(branchId, salonId);
  return NextResponse.json({ barbers });
}
