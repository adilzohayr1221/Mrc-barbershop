import { NextResponse } from 'next/server';
import { listMemberships, saveMembership, listRedemptions } from '@/lib/store';
import { syncMembershipFromStripe, buildWeeks, membershipPlanName } from '@/lib/membership';
import { sendPushToUser, isPushConfigured } from '@/lib/push';

export const dynamic = 'force-dynamic';

// Called on a schedule (x-cron-secret). When a new week of a plan becomes
// available, the customer gets one push: "Week N is ready — show your code."
// Sent once per week per plan (weekAlertsSent flags on the membership).
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'push not configured' });
  }

  const memberships = await listMemberships();
  let sent = 0;
  for (const raw of memberships) {
    const m = (await syncMembershipFromStripe(raw)) ?? raw;
    if (m.status !== 'active') continue;
    const redemptions = await listRedemptions(m.id);
    const weeks = buildWeeks(m, redemptions);
    const current = weeks.find((w) => w.state === 'available');
    if (!current) continue;
    const key = `${m.currentPeriodStart}#${current.index}`;
    if ((m.weekAlertsSent ?? []).includes(key)) continue;

    const weekService =
      m.planKind === 'custom' && m.weeklyServices?.[current.index]
        ? m.weeklyServices[current.index].name
        : 'haircut';
    try {
      await sendPushToUser('customer', m.customerId, {
        title: `${current.label} is ready ✂️`,
        body:
          m.planKind === 'custom'
            ? `Your ${weekService} is ready — show your ${membershipPlanName(m)} code at the shop.`
            : `Your weekly haircut is ready — show your plan code at the shop.`,
        url: '/customer/offers',
      });
      sent++;
      await saveMembership({ ...m, weekAlertsSent: [...(m.weekAlertsSent ?? []), key] });
    } catch (e) {
      console.error('[cron] plan-week alert failed', m.id, e);
    }
  }
  return NextResponse.json({ ok: true, sent });
}
