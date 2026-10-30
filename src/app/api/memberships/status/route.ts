import { NextResponse } from 'next/server';

import { requireActiveCustomer } from "@/lib/guard";
import { listRedemptions, getCustomer } from '@/lib/store';
import { listActiveMemberships, buildWeeks, currentGuestSlot, PLAN_PRICE_USD, PLAN_HAIRCUTS, membershipPrice, membershipPlanName, membershipInterval } from '@/lib/membership';

export const dynamic = 'force-dynamic';

// Customer-only: all of my plans (one account can hold several — e.g. for
// family members) + the weekly haircut windows for each (4 monthly · 48 yearly).
export async function GET(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const memberships = await listActiveMemberships(session.customerId);
  if (!memberships.length) {
    return NextResponse.json({
      memberships: [],
      // Back-compat for older clients.
      membership: null,
      plan: { price: PLAN_PRICE_USD, haircuts: PLAN_HAIRCUTS },
    });
  }
  const customer = await getCustomer(session.customerId);
  const rows = await Promise.all(
    memberships.map(async (membership) => {
      const redemptions = await listRedemptions(membership.id);
      const weeks = buildWeeks(membership, redemptions).map((w) => ({
        index: w.index,
        label: w.label,
        start: w.start.toISOString(),
        end: w.end.toISOString(),
        state: w.state,
      }));
      return {
        id: membership.id,
        status: membership.status,
        cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
        currentPeriodStart: membership.currentPeriodStart,
        currentPeriodEnd: membership.currentPeriodEnd,
        memberName: customer?.name ?? '',
        weeks,
        currentWeekAvailable: weeks.some((w) => w.state === 'available'),
        planKind: membership.planKind ?? 'standard',
        planName: membershipPlanName(membership),
        planPrice: membershipPrice(membership),
        planInterval: membershipInterval(membership),
        totalWeeks: weeks.length,
        // Yearly-plan guest slot for the CURRENT week (null on other plans).
        guestSlot:
          membership.planKind === 'yearly'
            ? (() => {
                const g = currentGuestSlot(membership, redemptions);
                return g
                  ? { state: g.state, weekIndex: g.index, label: g.label, start: g.start.toISOString(), end: g.end.toISOString() }
                  : null;
              })()
            : null,
        guestWeeksUsed:
          membership.planKind === 'yearly'
            ? redemptions.filter((r) => r.guest === true && r.periodStart === membership.currentPeriodStart).length
            : 0,
        weeklyServices: membership.weeklyServices ?? null,
      };
    })
  );
  return NextResponse.json({
    memberships: rows,
    // Back-compat: the newest membership, for older clients.
    membership: rows[0] ?? null,
    plan: { price: PLAN_PRICE_USD, haircuts: PLAN_HAIRCUTS },
  });
}
