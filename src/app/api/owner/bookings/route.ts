import { NextResponse } from 'next/server';
import { listBookings, getBarbers, getServices, getBranches, getCustomers, stripBookingSecrets } from '@/lib/store';
import { signPhotoUrl } from "@/lib/auth";
import { requireActiveOwner } from "@/lib/guard";

export const dynamic = 'force-dynamic';

// Owner-only: full booking list incl. customer PII (auth verified first).
export async function GET(req: Request) {
  if (!(await requireActiveOwner(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [bookings, barbers, services, branches, customers] = await Promise.all([
    listBookings(),
    getBarbers(),
    getServices(),
    getBranches(),
    getCustomers(),
  ]);
  const barberMap = new Map(barbers.map((b) => [b.id, b.name]));
  const serviceMap = new Map(services.map((s) => [s.id, s]));
  const branchMap = new Map(branches.map((b) => [b.id, b.address]));
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const photoMap = new Map(
    customers.map((c) => [c.id, c.photoPath ? signPhotoUrl(c.photoPath.split('/').pop() || '') : null])
  );
  return NextResponse.json({
    bookings: bookings.map((b) => ({
      // Audit M13 (2026-10-29): strip the collect token + Stripe ids from
      // the payload — the dashboard never needs them.
      ...stripBookingSecrets(b),
      barberName: barberMap.get(b.barberId) ?? '',
      serviceName: b.houseCall ? 'VIP Home Visit' : (serviceMap.get(b.serviceId)?.name ?? ''),
      branchAddress: branchMap.get(b.branchId) ?? '',
      customerEmail: b.customerId ? customerMap.get(b.customerId)?.email ?? null : null,
      customerPhotoUrl: b.customerId ? photoMap.get(b.customerId) ?? null : null,
    })),
  });
}
