import { NextResponse } from 'next/server';
import { requireActiveBarber } from '@/lib/guard';
import { getCustomer, listRedemptions, getRedemption, saveRedemption, saveMembership, listBookings, saveBooking, saveCompletionPhoto, newId, claimOnce, releaseClaim } from '@/lib/store';
import { getMembershipById, buildWeeks, buildGuestWeeks, membershipRedemptionPayout, membershipPayoutKey, membershipPlanName, currentPlanWindowIndex } from '@/lib/membership';
import { planKindOf } from '@/lib/planWindows';
import { shopToday } from '@/lib/earnings';
import { salonOf } from '@/lib/store';
import { barberSalonId } from '@/lib/salonScope';

export const dynamic = 'force-dynamic';

// Barber redeems one weekly haircut by scanning the member's code.
// - preview=true (JSON { membershipId, token, preview }): validate and return
//   the summary WITHOUT redeeming.
// - otherwise (multipart with the proof-of-completion PHOTO, like DoorDash
//   proof-of-delivery): record the redemption (once per week), auto-link
//   today's pending membership booking, and pay out. NO PHOTO = NO PAYOUT.
export async function POST(req: Request) {
  const session = await requireActiveBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const ct = req.headers.get('content-type') || '';
  let membershipId: unknown;
  let token: unknown;
  let preview = false;
  // Yearly-plan GUEST cut: same scan, same photo gate, separate slot/record.
  let guest = false;
  let form: FormData | null = null;
  if (ct.includes('multipart/form-data')) {
    form = await req.formData().catch(() => null);
    membershipId = form?.get('membershipId');
    token = form?.get('token');
    preview = form?.get('preview') === 'true';
    guest = form?.get('guest') === 'true';
  } else {
    const body = await req.json().catch(() => null);
    membershipId = body?.membershipId;
    token = body?.token;
    preview = body?.preview === true;
    guest = body?.guest === true;
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

  // Audit M10 (2026-10-22): a plan can only be redeemed inside its own
  // salon — a platform barber must not redeem (and be paid for) another
  // salon's membership, and the haircut counts under the plan's salon.
  const mySalon = await barberSalonId(session);
  if (salonOf(membership) !== mySalon) {
    return NextResponse.json({ error: 'This plan belongs to a different salon.' }, { status: 403 });
  }

  // Guest cuts exist ONLY on the yearly plan (owner rule, 2026-10-28).
  if (guest && membership.planKind !== 'yearly') {
    return NextResponse.json(
      { error: 'Guest cuts are a Master Yearly Plan perk — this plan does not include one.' },
      { status: 403 }
    );
  }

  const redemptions = await listRedemptions(membership.id);
  // Member flow uses his own weeks; the guest flow uses the parallel guest
  // slots — same windows, separate records, never interchangeable.
  const weeks = guest ? buildGuestWeeks(membership, redemptions) : buildWeeks(membership, redemptions);
  // Audit M5 (2026-10-22): redeem exactly the one 'available' week. The old
  // picker took the first available-OR-used week in array order, so an
  // earlier used week shadowed the current available one (false "already
  // used") and week selection depended on array order, not the calendar.
  const current = weeks.find((w) => w.state === 'available');
  if (!current && preview && !guest && membership.planKind === 'yearly') {
    // Member's own week is spent, but this week's GUEST slot is still open:
    // let the scan continue in guest-only mode instead of erroring — the
    // barber confirms the guest cut from the same screen.
    const g = buildGuestWeeks(membership, redemptions).find((w) => w.state === 'available');
    if (g) {
      const customer = await getCustomer(membership.customerId);
      return NextResponse.json({
        ok: true,
        preview: true,
        customerName: customer?.name ?? 'Member',
        weekLabel: g.label,
        periodEnd: membership.currentPeriodEnd,
        planName: membershipPlanName(membership),
        planKind: planKindOf(membership),
        guestAvailable: true,
        guestWeekLabel: g.label,
        memberWeekUsed: true,
      });
    }
  }
  if (!current) {
    // Generalized window index: 0..3 for monthly plans, 0..47 for yearly.
    const curIdx = currentPlanWindowIndex(
      membership,
      new Date(membership.currentPeriodStart),
      new Date(membership.currentPeriodEnd)
    );
    if (weeks[curIdx]?.state === 'used') {
      return NextResponse.json(
        {
          error: guest
            ? "This week's guest cut was already used. Unused weeks don't carry over."
            : "This week's haircut was already used. Unused weeks don't carry over.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: guest ? 'No guest cut is available on this plan right now.' : 'No weekly haircut is available on this plan right now.' },
      { status: 409 }
    );
  }

  const customer = await getCustomer(membership.customerId);
  const weekService = !guest && membership.planKind === 'custom' ? membership.weeklyServices?.[current.index] : null;
  // For the barber scanner: on a yearly plan, tell the confirm screen
  // whether this week's GUEST slot can still be spent (and its label), so
  // the barber can mark the scan as the guest's cut instead of the member's.
  const guestSlot =
    membership.planKind === 'yearly' ? buildGuestWeeks(membership, redemptions).find((w) => w.state === 'available') : undefined;
  const summary = {
    customerName: customer?.name ?? 'Member',
    weekLabel: current.label,
    periodEnd: membership.currentPeriodEnd,
    // The barber scan screen labels the plan from the plan actually
    // scanned (a yearly plan must not render as "Monthly — 4 haircuts").
    planName: membershipPlanName(membership),
    planKind: planKindOf(membership),
    ...(guest ? { guest: true } : {}),
    ...(membership.planKind === 'yearly'
      ? { guestAvailable: !!guestSlot, ...(guestSlot ? { guestWeekLabel: guestSlot.label } : {}) }
      : {}),
    ...(weekService ? { serviceName: weekService.name } : {}),
  };
  if (preview) {
    return NextResponse.json({ ok: true, preview: true, ...summary });
  }

  // Record the redemption (idempotent per week: re-check under the same
  // key). The key includes the guest flag, so the member's own redemption
  // and the guest's are independent slots in the same window.
  const fresh = await listRedemptions(membership.id);
  if (
    fresh.some(
      (r) =>
        (r.guest === true) === guest &&
        r.weekIndex === current.index &&
        r.periodStart === membership.currentPeriodStart
    )
  ) {
    return NextResponse.json(
      { error: guest ? "This week's guest cut was already used." : "This week's haircut was already used." },
      { status: 409 }
    );
  }

  // Audit M4 (2026-10-29): claim this exact redemption slot atomically
  // BEFORE the photo/payout — the list re-check above can be served stale,
  // so two concurrent scans of the same code could both record a
  // redemption (double loyalty count, double records). The claim key is
  // the redemption's identity: membership + week + period + guest flag.
  const redeemClaimKey = `redeem-membership-${membership.id}-${current.index}-${membership.currentPeriodStart}-${guest ? 'guest' : 'member'}`;
  if (!(await claimOnce(redeemClaimKey))) {
    return NextResponse.json(
      { error: guest ? "This week's guest cut was already used." : "This week's haircut was already used." },
      { status: 409 }
    );
  }

  // Proof photo first — no photo, no payout.
  let photoPath: string;
  try {
    if (!form) throw new Error('Take a photo of the finished haircut to get paid.');
    photoPath = await saveCompletionPhoto(form, 'plan');
  } catch (e) {
    await releaseClaim(redeemClaimKey);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Take a photo of the finished haircut to get paid.' },
      { status: 400 }
    );
  }

  // Auto-link today's pending membership booking for THIS plan with this barber, if any.
  // (Legacy bookings without a membershipId still link to the first matching plan.)
  // Shop-local today — server-local getters are UTC on Vercel and would
  // compute tomorrow's date every evening (8 PM–midnight ET), silently
  // missing the auto-link.
  const today = shopToday();
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
        (!b.membershipId || b.membershipId === membership.id) &&
        // Guest redemptions link ONLY guest bookings and vice versa — a
        // member scan can never consume his guest's appointment or the
        // reverse. (Legacy bookings predate the flag and count as member.)
        (guest ? b.membershipGuest === true : !b.membershipGuest)
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
    ...(guest ? { guest: true } : {}),
  });
  // Single-use code: invalidate so it can't be scanned twice.
  await saveMembership({ ...membership, qrToken: null, qrTokenExpiry: null });

  // Loyalty & barber milestones: count this completed plan haircut.
  try {
    const { recordHaircut } = await import('@/lib/loyalty');
    await recordHaircut({
      barberId: session.barberId,
      // A guest cut counts toward the BARBER's milestones like any plan cut,
      // but it is not the member's own haircut, so it must not accrue the
      // member's personal loyalty progress — no customerId for guests.
      customerId: guest ? null : membership.customerId,
      paid: true,
      // Audit M10: count under the membership's own salon (== the barber's,
      // enforced above), not whatever the session happens to carry.
      salonId: salonOf(membership),
    });
  } catch (e) {
    console.error('[redeem] loyalty hook failed', e);
  }

  // Plan haircut payout, paid immediately to the redeeming barber:
  // monthly plan $30 (Mix & Match: 25% of its price); YEARLY plan $25 for
  // the member's own cut AND the guest cut alike (owner's rules).
  let payoutFailed: string | null = null;
  let payoutTransferId: string | null = null;
  try {
    const { payoutToBarber } = await import('@/lib/payouts');
    // Yearly plan: $25 for member and guest alike; monthly family: $30/25%.
    const payoutAmount = membershipRedemptionPayout(membership, guest);
    const result = await payoutToBarber(session.barberId, payoutAmount, {
      idempotencyKey: membershipPayoutKey(membership.id, current.index, membership.currentPeriodStart, guest),
      description: guest
        ? `MRC Barbershops — plan GUEST haircut payout (${current.label})`
        : `MRC Barbershops — plan haircut payout (${current.label})`,
      // Audit H3: week + period are part of the transfer's identity so the
      // retry sweep can match THIS redemption exactly.
      metadata: {
        kind: 'membership_payout',
        membershipId: membership.id,
        weekIndex: String(current.index),
        periodStart: membership.currentPeriodStart,
        ...(guest ? { guest: '1' } : {}),
      },
    });
    if (result.ok) payoutTransferId = result.transferId ?? null;
    // Audit L4 (2026-10-29): raw payout errors stay in the server log; the
    // client gets a generic message (the sweep retries automatically).
    else {
      console.error('[payout] membership payout failed', result.error);
      payoutFailed = 'Payout failed — it will be retried automatically.';
    }
  } catch (e) {
    console.error('[payout] membership payout failed', e);
    payoutFailed = 'Payout failed — it will be retried automatically.';
  }
  // Persist the payout outcome on the redemption so a failure is retried
  // automatically by the payout sweep instead of stranding the barber's pay.
  try {
    const red = await getRedemption(redemptionId);
    if (red) {
      red.payoutTransferId = payoutTransferId;
      red.payoutFailed = payoutFailed != null;
      await saveRedemption(red);
    }
  } catch (e) {
    console.error('[redeem] payout outcome persist failed', e);
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
