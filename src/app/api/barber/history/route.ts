import { NextResponse } from 'next/server';
import { listBookings, getServices, getCustomers, inSalon } from '@/lib/store';
import { requireActiveBarber } from '@/lib/guard';
import { barberSalonId } from '@/lib/salonScope';
import { earningOf, isHaircutDone } from '@/lib/earnings';
import { yearlyMembershipIdsIn } from '@/lib/membership';
import { signPhotoUrl } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Barber-only: my work history — every date I worked (tap a date to see
// that day's customers) and my customers ranked by how many times they
// came to me. A "visit" is a completed haircut (the same counting rule as
// the leaderboard and My bonuses), and the money shown is the barber-view
// earned amount for that haircut. Customers carry their profile photo (or
// null — the client falls back to a colored initial) and their usual
// service, so the barber recognizes them at a glance.
export async function GET(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session || !session.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = await barberSalonId(session);
  const [bookings, services, customers] = await Promise.all([listBookings(), getServices(), getCustomers()]);
  const serviceMap = new Map(services.filter((s) => inSalon(s, salonId)).map((s) => [s.id, s.name]));
  const photoById = new Map(
    customers.map((c) => [c.id, c.photoPath ? signPhotoUrl(c.photoPath.split('/').pop() || '') : null])
  );
  const mine = bookings.filter(
    (b) => inSalon(b, salonId) && b.barberId === session.barberId && isHaircutDone(b)
  );
  const yearlyIds = await yearlyMembershipIdsIn(mine);
  const serviceNameOf = (b: (typeof mine)[number]) =>
    b.houseCall ? 'VIP Home Visit' : (serviceMap.get(b.serviceId) ?? '');
  const photoOf = (b: (typeof mine)[number]) => (b.customerId ? (photoById.get(b.customerId) ?? null) : null);

  const r2 = (n: number) => Math.round(n * 100) / 100;

  // ---- Worked dates, newest first; each expands to that day's customers.
  const byDate = new Map<
    string,
    {
      date: string;
      earned: number;
      items: { time: string; customerName: string; serviceName: string; earned: number; photoUrl: string | null }[];
    }
  >();
  for (const b of mine) {
    let day = byDate.get(b.date);
    if (!day) {
      day = { date: b.date, earned: 0, items: [] };
      byDate.set(b.date, day);
    }
    const earned = earningOf(b, true, yearlyIds);
    day.earned = r2(day.earned + earned);
    day.items.push({
      time: b.time,
      customerName: b.customerName,
      serviceName: serviceNameOf(b),
      earned,
      photoUrl: photoOf(b),
    });
  }
  const dates = [...byDate.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => ({
      date: d.date,
      customers: d.items.length,
      earned: d.earned,
      items: d.items.sort((a, b) => a.time.localeCompare(b.time)),
    }));

  // ---- Customers ranked by visits (most first), then most recent.
  const byCustomer = new Map<
    string,
    {
      name: string;
      phone: string;
      visits: number;
      lastDate: string;
      earned: number;
      photoUrl: string | null;
      serviceCounts: Map<string, number>;
    }
  >();
  for (const b of mine) {
    const key = b.customerId || b.customerPhone || b.customerName;
    let c = byCustomer.get(key);
    if (!c) {
      c = {
        name: b.customerName,
        phone: b.customerPhone ?? '',
        visits: 0,
        lastDate: b.date,
        earned: 0,
        photoUrl: photoOf(b),
        serviceCounts: new Map(),
      };
      byCustomer.set(key, c);
    }
    c.visits += 1;
    c.earned = r2(c.earned + earningOf(b, true, yearlyIds));
    const sn = serviceNameOf(b);
    if (sn) c.serviceCounts.set(sn, (c.serviceCounts.get(sn) ?? 0) + 1);
    if (!c.photoUrl) c.photoUrl = photoOf(b);
    if (b.date >= c.lastDate) {
      c.lastDate = b.date;
      c.name = b.customerName;
      if (b.customerPhone) c.phone = b.customerPhone;
    }
  }
  const customersOut = [...byCustomer.values()]
    .sort((a, b) => b.visits - a.visits || b.lastDate.localeCompare(a.lastDate))
    .map((c) => ({
      name: c.name,
      phone: c.phone,
      visits: c.visits,
      lastDate: c.lastDate,
      earned: c.earned,
      photoUrl: c.photoUrl,
      usualService: [...c.serviceCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
    }));

  return NextResponse.json({ ok: true, dates, customers: customersOut });
}
