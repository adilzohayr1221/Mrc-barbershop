import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { listComplaints, getBarbers, getCustomers } from '@/lib/store';

export const dynamic = 'force-dynamic';

function photoUrlOf(p: { photoPath: string }): string {
  return `/api/photos/${encodeURIComponent(p.photoPath.split('/').pop() || '')}`;
}

// GET /api/owner/complaints — all complaints with customer/barber names.
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [complaints, barbers, customers] = await Promise.all([
    listComplaints(),
    getBarbers(),
    getCustomers(),
  ]);
  const barberName = new Map(barbers.map((b) => [b.id, b.name]));
  const custName = new Map(customers.map((c) => [c.id, c.name]));
  return NextResponse.json({
    complaints: complaints.map((c) => ({
      id: c.id,
      customerName: custName.get(c.customerId) ?? 'Customer',
      barberName: barberName.get(c.barberId) ?? 'Barber',
      serviceName: c.serviceName ?? null,
      text: c.text,
      photoUrl: photoUrlOf(c),
      status: c.status,
      createdAt: c.createdAt,
      resolvedAt: c.resolvedAt ?? null,
    })),
  });
}
