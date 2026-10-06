import { NextResponse } from 'next/server';
import { listBookings, getBarbers, getServices, getBranches, getCustomers } from '@/lib/store';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Owner-only: full booking list incl. customer PII (auth verified first).
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
  return NextResponse.json({
    bookings: bookings.map((b) => ({
      ...b,
      barberName: barberMap.get(b.barberId) ?? '',
      serviceName: serviceMap.get(b.serviceId)?.name ?? '',
      branchAddress: branchMap.get(b.branchId) ?? '',
      customerEmail: b.customerId ? customerMap.get(b.customerId)?.email ?? null : null,
    })),
  });
}
