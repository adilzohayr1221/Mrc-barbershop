import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';
import { listShopProducts, inSalon } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Barber: list supply-shop products (in-stock and out-of-stock).
export async function GET(req: Request) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = await barberSalonId(session);
  const products = (await listShopProducts()).filter((p) => inSalon(p, salonId));
  return NextResponse.json({ products });
}
