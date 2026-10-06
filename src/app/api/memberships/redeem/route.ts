import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { getCustomer, listRedemptions, saveRedemption, saveMembership, listBookings, saveBooking, saveCompletionPhoto, newId } from '@/lib/store';
import { getMembershipById, buildWeeks, membershipPayoutPerWeek } from '@/lib/membership';

export const dynamic = 'force-dynamic';

// Barber redeems one weekly haircut by scanning the member's code.
// - preview=true (JSON { membershipId, token, preview }): validate and return
//   the summary WITHOUT redeeming.
// - otherwise (multipart with the proof-of-completion PHOTO, like DoorDash
//   proof-of-delivery): record the redemption (once per week), auto-link
//   today's pending membership booking, and pay out. NO PHOTO = NO PAYOUT.
export async function POST(req: Request) {
  const session = requireBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const ct = req.headers.get('content-type') || '';
  let membershipId: unknown;
  let token: unknown;
  let preview = false;
  let form: FormData | null = null;
  if (ct.includes('multipart/form-data')) {
    form = await req.formData().catch(() => null);
    membershipId = form?.get('membershipId');
    token = form?.get('token');
    preview = form?.get('preview') === 'true';
  } else {
    const body = await req.json().catch(() => null);
    membershipId = body?.membershipId;
    token = body?.token;
    preview = body?.preview === true;
  }
  if (typeof membershipId !== 'string' || !membershipId || typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'Invalid code.' }, { status: 400 });
  }

  const membership = await getMembershipById(membershipId);
  if (!membership) {
    return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
  }
  if (membership.status === 'past_due') {
    return NextResponse.json(
      { error: 'This plan has a failed payment. The member needs to fix it before redeeming.' },
      { status: 402 }
    );
  }
  if (membership.status !== 'active') {
    return NextResponse.json({ error: 'This plan is not active.' }, { status: 403 });
  }
  if (!membership.qrToken || membership.qrToken !== token) {
    return NextResponse.json(
      { error: 'This code is no longer valid. Ask the member to show a fresh code.' },
      { status: 403 }
    );
  }
  if (membership.qrTokenExpiry && new Date(membership.qrTokenExpiry).getTime() < Date.now()) {
    return NextResponse.json(
      { error: 'Code expired. Ask the member to show a fresh code.' },
      { status: 403 }
    );
  }

  const redemptions = await listRedemptions(membership.id);
  const weeks = buildWeeks(membership, redemptions);
  const current = weeks.find((w) => w.state === 'available' || w.state === 'used');
  if (!current || current.state === 'used') {
    return NextResponse.json(
      { error: "This week's haircut was already used. Unused weeks don't carry over." },
      { status: 409 }
    );
  }

  const customer = await getCustomer(membership.customerId);
  const weekService = membership.planKind === 'custom' ? membership.weeklyServices?.[current.index] : null;
  const summary = {
    customerName: customer?.name ?? 'Member',
    weekLabel: current.label,
    periodEnd: membership.currentPeriodEnd,
    ...(weekService ? { serviceName: weekService.name } : {}),
  };
  if (preview) {
    return NextResponse.json({ ok: true, preview: true, ...summary });
  }

  // Record the redemption (idempotent per week: re-check under the same key).
  const fresh = await listRedemptions(membership.id);
  if (fresh.some((r) => r.weekIndex === current.index && r.periodStart === membership.currentPeriodStart)) {
    return NextResponse.json({ error: "This week's haircut was already used." }, { status: 409 });
  }

  // Proof photo first — no photo, no payout.
  let photoPath: string;
  try {
    if (!form) throw new Error('Take a photo of the finished haircut to get paid.');
    photoPath = await saveCompletionPhoto(form, 'plan');
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Take a photo of the finished haircut to get paid.' },
      { status: 400 }
    );
  }

  // Auto-link today's pending membership booking for THIS plan with this barber, if any.
  // (Legacy bookings without a membershipId still link to the first matching plan.)
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  let bookingId: string | null = null;
  try {
    const bookings = await listBookings();
    const match = bookings.find(
      (b) =>
        b.status === 'booked' &&
        b.barberId === session.barberId &&
        b.customerId === membership.customerId &&
        b.date === today &&
        b.paymentStatus === 'membership_pending' &&
        (!b.membershipId || b.membershipId === membership.id)
    );
    if (match) {
      match.paymentStatus = 'membership_redeemed';
      match.completionPhotoPath = photoPath;
      await saveBooking(match);
      bookingId = match.id;
    }
  } catch (e) {
    console.error('Membership booking link failed', e);
  }

  const redemptionId = newId();
  await saveRedemption({
    id: redemptionId,
    membershipId: membership.id,
    customerId: membership.customerId,
    barberId: session.barberId,
    weekIndex: current.index,
    periodStart: membership.currentPeriodStart,
    redeemedAt: new Date().toISOString(),
    bookingId,
    photoPath,
  });
  // Single-use code: invalidate so it can't be scanned twice.
  await saveMembership({ ...membership, qrToken: null, qrTokenExpiry: null });

  // Plan haircut payout: the redeeming barber gets 25% of the plan price
  // immediately ($30 for the standard $120 plan). Total payouts can never
  // exceed what the customer paid for the plan.
  let payoutFailed: string | null = null;
  try {
    const { payoutToBarber } = await import('@/lib/payouts');
    const payoutAmount = membershipPayoutPerWeek(membership);
    const result = await payoutToBarber(session.barberId, payoutAmount, {
      idempotencyKey: `payout-membership-${membership.id}-${current.index}-${membership.currentPeriodStart}`,
      description: `MRC Barbershop — plan haircut payout (${current.label})`,
      metadata: { kind: 'membership_payout', membershipId: membership.id },
    });
    if (!result.ok) payoutFailed = result.error ?? 'Payout failed.';
  } catch (e) {
    payoutFailed = e instanceof Error ? e.message : 'Payout failed.';
    console.error('[payout] membership payout failed', payoutFailed);
  }

  // Ask the customer to rate + tip (the haircut is done — photo taken).
  try {
    const { getBarbers } = await import('@/lib/store');
    const barberName = (await getBarbers()).find((b) => b.id === session.barberId)?.name ?? 'your barber';
    void notifyCustomerForReview(membership.customerId, barberName, `redemption:${redemptionId}`);
  } catch (e) {
    console.error('[redeem] review push failed', e);
  }

  return NextResponse.json({ ok: true, redeemed: true, payoutFailed, ...summary });
}

async function notifyCustomerForReview(customerId: string, barberName: string, ref: string) {
  try {
    const { sendPushToUser } = await import('@/lib/push');
    await sendPushToUser('customer', customerId, {
      title: 'How was your haircut? ⭐',
      body: `Rate ${barberName} and leave a tip if you liked it.`,
      url: `/customer/thanks?ref=${encodeURIComponent(ref)}`,
    });
  } catch (e) {
    console.error('[redeem] review push failed', e);
  }
}
