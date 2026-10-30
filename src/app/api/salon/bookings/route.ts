import { NextResponse } from 'next/server';
import { listBookings, getBarbers, getServices, getBranches, getCustomers, inSalon, stripBookingSecrets } from '@/lib/store';
import { sessionSalonId } from '@/lib/auth';
import { requireActiveSalonOwner } from '@/lib/guard';
import { shopToday, shopNowTime } from '@/lib/earnings';

export const dynamic = 'force-dynamic';

// Salon-owner: full booking list for HIS salon only (customer PII is
// included because he owns these appointments). Same shape as the
// super-admin owner bookings route, scoped to the salon.
export async function GET(req: Request) {
  const session = await requireActiveSalonOwner(req);
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
  // Audit M8 (2026-10-22): "upcoming" is computed on the SHOP's wall clock
  // (America/New_York), not UTC — the old ISO slice rolled the date over at
  // 8 PM Eastern and mis-sorted the whole evening.
  const nowKey = shopToday() + shopNowTime();
  const enriched = bookings
    .filter((b) => inSalon(b, salonId))
    .map((b) => ({
      // Audit M13 (2026-10-29): never leak the collect token or Stripe ids
      // to the salon-owner's device — same strip list as the barber schedule.
      ...stripBookingSecrets(b),
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
