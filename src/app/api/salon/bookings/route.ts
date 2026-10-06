import { NextResponse } from 'next/server';
import { listBookings, getBarbers, getServices, getBranches, getCustomers, inSalon } from '@/lib/store';
import { requireSalonOwner, sessionSalonId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Salon-owner: full booking list for HIS salon only (customer PII is
// included because he owns these appointments). Same shape as the
// super-admin owner bookings route, scoped to the salon.
export async function GET(req: Request) {
  const session = requireSalonOwner(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const salonId = sessionSalonId(session);
  const [bookings, barbers, services, branches, customers] = await Promise.all([
    listBookings(),
    getBarbers(),
    getServices(),
    getBranches(),
    getCustomers(),
  ]);
  const myBarbers = barbers.filter((b) => inSalon(b, salonId));
  const myServices = services.filter((s) => inSalon(s, salonId));
  const myBranches = branches.filter((b) => inSalon(b, salonId));
  const myCustomers = customers.filter((c) => inSalon(c, salonId));
  const barberMap = new Map(myBarbers.map((b) => [b.id, b.name]));
  const serviceMap = new Map(myServices.map((s) => [s.id, s]));
  const branchMap = new Map(myBranches.map((b) => [b.id, b.address]));
  const customerMap = new Map(myCustomers.map((c) => [c.id, c]));
  const nowKey = new Date().toISOString().slice(0, 16).replace('T', '');
  const enriched = bookings
    .filter((b) => inSalon(b, salonId))
    .map((b) => ({
      ...b,
      barberName: barberMap.get(b.barberId) ?? '',
      serviceName: serviceMap.get(b.serviceId)?.name ?? '',
      branchAddress: branchMap.get(b.branchId) ?? '',
      customerEmail: b.customerId ? customerMap.get(b.customerId)?.email ?? null : null,
    }))
    .sort((a, b) => {
      // Upcoming first, then the rest — each by date/time ascending.
      const aUp = a.status === 'booked' && a.date + a.time >= nowKey;
      const bUp = b.status === 'booked' && b.date + b.time >= nowKey;
      if (aUp !== bUp) return aUp ? -1 : 1;
      return (a.date + a.time).localeCompare(b.date + b.time);
    });
  return NextResponse.json({ bookings: enriched });
}
