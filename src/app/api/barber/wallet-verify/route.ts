import { NextResponse } from 'next/server';
import { requireActiveBarber } from '@/lib/guard';
import { getCustomer, listRedemptions, salonOf } from '@/lib/store';
import { getMembershipById, buildWeeks, membershipPlanName } from '@/lib/membership';
import { planKindOf } from '@/lib/planWindows';
import { barberSalonId } from '@/lib/salonScope';

export const dynamic = 'force-dynamic';

// Barber scans a customer's Apple Wallet pass QR (MRCW:membershipId).
// Verifies the membership is active and returns the member summary.
// No token needed — the wallet pass is a static identifier.
export async function POST(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const membershipId = body?.membershipId;
  if (typeof membershipId !== 'string' || !membershipId) {
    return NextResponse.json({ error: 'Invalid code.' }, { status: 400 });
  }

  const membership = await getMembershipById(membershipId);
  if (!membership) {
    return NextResponse.json({ error: 'Membership not found.' }, { status: 404 });
  }
  if (membership.status !== 'active') {
    return NextResponse.json({ error: 'This membership is not active.' }, { status: 403 });
  }
  // Audit M14 (2026-10-29): a barber may only verify memberships of his
  // OWN salon — the pass QR is a static identifier, so without this check
  // any barber could probe other salons' memberships by id.
  if (salonOf(membership) !== (await barberSalonId(session))) {
    return NextResponse.json({ error: 'Membership not found.' }, { status: 404 });
  }

  const customer = await getCustomer(membership.customerId);
  const redemptions = await listRedemptions(membership.id);
  const weeks = buildWeeks(membership, redemptions);
  const currentWeek = weeks.find((w) => w.state === 'available');
  const planName = membershipPlanName(membership);

  return NextResponse.json({
    ok: true,
    customerName: customer?.name || 'Member',
    membershipId: membership.id,
    planName,
    planKind: planKindOf(membership),
    serviceName: planName,
    weekLabel: currentWeek ? currentWeek.label : 'All weeks used',
    validUntil: membership.currentPeriodEnd || null,
  });
}
