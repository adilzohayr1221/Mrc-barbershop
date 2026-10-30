import { NextResponse } from 'next/server';
import { getBranches, resolveSalon, inSalon } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(req.url);
  const salonParam = searchParams.get('salon');
  let salonId = 'mrc';
  if (salonParam) {
    const salon = await resolveSalon(salonParam);
    // Audit M5 (2026-10-29): a suspended salon does not resolve publicly.
    if (!salon || salon.status !== 'active') return NextResponse.json({ error: 'Salon not found.' }, { status: 404 });
    salonId = salon.id;
  }
  const branches = (await getBranches()).filter((b) => inSalon(b, salonId));
  return NextResponse.json({ branches });
}
