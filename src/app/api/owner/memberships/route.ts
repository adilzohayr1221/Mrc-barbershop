import { NextResponse } from 'next/server';
import { listMemberships, listRedemptions, getCustomers } from '@/lib/store';
import { requireOwner } from '@/lib/auth';
import { syncMembershipFromStripe, buildWeeks, membershipPrice, membershipPlanName } from '@/lib/membership';

export const dynamic = 'force-dynamic';

// Owner-only: all monthly-plan memberships with customer info and week usage.
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [memberships, customers] = await Promise.all([listMemberships(), getCustomers()]);
  const custMap = new Map(customers.map((c) => [c.id, c]));
  const rows = await Promise.all(
    memberships.map(async (raw) => {
      const m = (await syncMembershipFromStripe(raw)) ?? raw;
      const redemptions = await listRedemptions(m.id);
      const weeks = buildWeeks(m, redemptions);
      const c = custMap.get(m.customerId);
      return {
        id: m.id,
        customerName: c?.name ?? '—',
        customerEmail: c?.email ?? '—',
        status: m.status,
        cancelAtPeriodEnd: m.cancelAtPeriodEnd,
        currentPeriodStart: m.currentPeriodStart,
        currentPeriodEnd: m.currentPeriodEnd,
        weeksUsed: weeks.filter((w) => w.state === 'used').length,
        createdAt: m.createdAt,
        planName: membershipPlanName(m),
        planPrice: membershipPrice(m),
      };
    })
  );
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ memberships: rows });
}
