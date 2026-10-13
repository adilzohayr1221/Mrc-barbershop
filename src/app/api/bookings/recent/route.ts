import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { listBookings, getBarbers, getServices } from '@/lib/store';
import { shopToday } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

// GET /api/bookings/recent — the customer's bookings from the last 14 days,
// so they can file a complaint about a haircut that already happened
// (appointments vanish from "My appointments" 60 min after the start).
export async function GET(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // 14 days before shop-local today, as a YYYY-MM-DD string.
  const [ty, tm, td] = shopToday().split('-').map(Number);
  const cutoffDate = new Date(Date.UTC(ty, tm - 1, td, 12));
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 14);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);
  const [bookings, barbers, services] = await Promise.all([
    listBookings(),
    getBarbers(),
    getServices(),
  ]);
  const barberName = new Map(barbers.map((b) => [b.id, b.name]));
  const svcName = new Map(services.map((s) => [s.id, s.name]));
  const rows = bookings
    .filter(
      (b) =>
        b.customerId === session.customerId &&
        b.status !== 'cancelled' &&
        b.date >= cutoffStr
    )
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    .slice(0, 20)
    .map((b) => ({
      id: b.id,
      date: b.date,
      time: b.time,
      barberName: barberName.get(b.barberId) ?? 'Barber',
      serviceName: svcName.get(b.serviceId) ?? null,
    }));
  return NextResponse.json({ bookings: rows });
}
