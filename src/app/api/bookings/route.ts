import { NextResponse } from 'next/server';
import { getBarbers, getServices, getBranches, getCustomer, listBookings, saveBooking, newId, listRedemptions, salonOf, claimOnce, releaseClaim } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';

import { requireActiveCustomer } from "@/lib/guard";
import { getStripe, isStripeConfigured, depositFor, toCents } from '@/lib/stripe';
import { orderFeeCents, fundingForPaymentMethod, captureByFunding } from '@/lib/cardFee';
import { discountPrice } from '@/lib/discount';
import { parseVipPeople, vipTotalUSD, vipClash, checkVipServiceArea, VIP_SERVICE_RADIUS_MILES } from '@/lib/vip';
import { buildWeeks, buildGuestWeeks, getMembershipById, listActiveMemberships } from '@/lib/membership';
import { shopToday, shopNowTime } from '@/lib/earnings';
import { sendPushToUser } from '@/lib/push';
import type { Booking, WorkingHours } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Customers create bookings. Requires a valid customer session — the booking
// is linked to the logged-in customer's account (customerId).
// Prepay: the client first creates a Stripe PaymentIntent via
// POST /api/payments/intent, confirms it with Stripe.js, then passes the
// paymentIntentId here. The server verifies with Stripe that the payment
// actually succeeded (and matches the service price) before saving anything.
// Returns the booking WITHOUT echoing PII beyond what the customer just submitted.
export async function POST(req: Request) {
  await ensureSeeded();
  const session = await requireActiveCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in to book.' }, { status: 401 });
  }
  // The account must still exist (an owner-deleted account cannot book, even with an old token).
  const customer = await getCustomer(session.customerId);
  if (!customer) {
    return NextResponse.json({ error: 'Please log in to book.' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const { barberId, serviceId, branchId, date, time, customerName, customerPhone, paymentIntentId } = body ?? {};
  const useMembership = body?.useMembership === true;
  const forGuest = body?.forGuest === true; // yearly-plan guest booking (free)
  const houseCall = body?.houseCall === true;
  const vipPeople = houseCall ? parseVipPeople(body?.vipPeople) : 1;
  const homeAddress = typeof body?.homeAddress === 'string' ? body.homeAddress.trim() : '';
  const visitNotes = houseCall && typeof body?.visitNotes === 'string' ? body.visitNotes.trim().slice(0, 300) : '';
  if (houseCall && useMembership) {
    return NextResponse.json({ error: 'VIP home visits are paid in full — plans do not cover them.' }, { status: 400 });
  }
  if (houseCall && (homeAddress.length < 8 || homeAddress.length > 200)) {
    return NextResponse.json({ error: 'Please enter your full home address for the visit.' }, { status: 400 });
  }

  if (typeof barberId !== 'string' || !barberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 });
  if (typeof serviceId !== 'string' || !serviceId) return NextResponse.json({ error: 'serviceId required' }, { status: 400 });
  if (typeof branchId !== 'string' || !branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 });
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'Invalid time' }, { status: 400 });
  if (typeof customerName !== 'string' || customerName.trim().length < 2 || customerName.trim().length > 60)
    return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  if (typeof customerPhone !== 'string' || customerPhone.replace(/\D/g, '').length < 7 || customerPhone.length > 25)
    return NextResponse.json({ error: 'Invalid phone' }, { status: 400 });

  const [barbers, services, branches, bookings] = await Promise.all([getBarbers(), getServices(), getBranches(), listBookings()]);
  // Audit M5 (2026-10-29): unapproved self-signup barbers are not bookable.
  const barber = barbers.find((b) => b.id === barberId && b.active && b.approved !== false);
  const service = services.find((s) => s.id === serviceId && s.active);
  const branch = branches.find((b) => b.id === branchId);
  if (!barber || !service || !branch) return NextResponse.json({ error: 'Invalid selection' }, { status: 400 });
  if (!barber.branchIds.includes(branchId)) return NextResponse.json({ error: 'Barber not at this branch' }, { status: 400 });
  if (houseCall && barber.houseCalls !== true) return NextResponse.json({ error: 'This barber does not offer home visits.' }, { status: 400 });
  // Service area, re-checked at booking time (the address is authoritative
  // here): the home must be within the radius of the branch.
  if (houseCall) {
    const area = await checkVipServiceArea(branch, homeAddress);
    if (!area.ok) {
      return NextResponse.json(
        {
          error:
            area.reason === 'unlocated'
              ? "We couldn't find that address — please check it and try again."
              : `Sorry — home visits are only available within ${VIP_SERVICE_RADIUS_MILES} miles of the shop.`,
        },
        { status: 400 }
      );
    }
  }

  // Never book a slot that has already started (shop-local wall clock).
  // The customer pays at booking time, and a past appointment is instantly
  // invisible in "My appointments" — money must never land on one.
  const todayStr = shopToday();
  if (date < todayStr || (date === todayStr && time <= shopNowTime())) {
    // Audit M6 (2026-10-22): if the client already paid an intent for this
    // now-past slot, refund it best-effort (idempotency-keyed) instead of
    // leaving an orphaned charge behind.
    if (typeof paymentIntentId === 'string' && paymentIntentId.startsWith('pi_') && isStripeConfigured()) {
      try {
        const orphan = await getStripe().paymentIntents.retrieve(paymentIntentId);
        if (orphan.status === 'succeeded') {
          await getStripe().refunds.create(
            { payment_intent: paymentIntentId },
            { idempotencyKey: `refund-orphan-${paymentIntentId}` }
          );
        }
      } catch (e) {
        console.error('Orphan intent refund failed', paymentIntentId, e);
      }
    }
    return NextResponse.json({ error: 'This time has already passed. Please pick a later time.' }, { status: 400 });
  }

  // Enforce the barber's own working hours (he sets them hour by hour).
  if (barber.workingHours) {
    const dayKey = String(new Date(date + 'T12:00:00').getDay()) as keyof WorkingHours;
    const hours = barber.workingHours[dayKey];
    const slotHour = time.slice(0, 2) + ':00';
    if (!hours || !hours.includes(slotHour)) {
      return NextResponse.json({ error: 'This barber is not working at the selected time.' }, { status: 400 });
    }
  }

  // A booked slot can't be booked twice.
  if (bookings.some((b) => b.barberId === barberId && b.date === date && b.time === time && b.status === 'booked')) {
    return NextResponse.json({ error: 'This time was just booked. Please pick another.' }, { status: 409 });
  }
  // A VIP home visit blocks 2 hours of the barber's day (and needs its own
  // 2-hour window free of other bookings); a normal booking blocks its
  // service's full duration (audit M7).
  const durationByService = new Map(services.map((s) => [s.id, s.durationMin]));
  const hasClash = (list: typeof bookings) =>
    list.some((b) => b.barberId === barberId && b.date === date && b.time === time && b.status === 'booked') ||
    vipClash(list, barberId, date, time, houseCall, service.durationMin, (b) => durationByService.get(b.serviceId) ?? 30);
  if (hasClash(bookings)) {
    return NextResponse.json({ error: 'This time was just booked. Please pick another.' }, { status: 409 });
  }
  const slotClaimKey = `slot-${barberId}-${date}-${time}`;

  // Approved student/military customers book at the discounted price.
  // The agreed total is stored on the booking so the remaining balance is
  // always computed from it, never from the live service price.
  // VIP home visits override this with the flat $100-per-person price.
  const finalPrice = houseCall ? vipTotalUSD(vipPeople) : discountPrice(service.price, customer);

  // Monthly-plan booking: no deposit. The member's weekly haircut credit is
  // consumed later, when the barber scans the membership code at the shop.
  // One pending membership booking per plan at a time (no slot blocking).
  // Body may carry membershipId when the account holds several plans.
  if (useMembership) {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
    }
    let membership = null;
    const wantedId = body?.membershipId;
    if (typeof wantedId === 'string' && wantedId) {
      membership = await getMembershipById(wantedId);
      if (!membership || membership.customerId !== session.customerId) {
        return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
      }
    } else {
      const all = await listActiveMemberships(session.customerId);
      membership = all.find((m) => m.status === 'active') ?? null;
    }
    if (!membership || membership.status !== 'active') {
      return NextResponse.json({ error: 'You need an active monthly plan to book this way.' }, { status: 403 });
    }
    // Guest bookings exist ONLY on the yearly plan (owner rule, 2026-10-28):
    // one free guest cut per weekly window, booked by the member.
    if (forGuest && membership.planKind !== 'yearly') {
      return NextResponse.json(
        { error: 'Guest bookings are a Master Yearly Plan perk — this plan does not include one.' },
        { status: 403 }
      );
    }
    // One pending plan booking per plan per SLOT KIND: the member's own
    // pending booking never blocks his guest booking and vice versa.
    // (Legacy bookings predate membershipGuest and count as member bookings.)
    if (
      bookings.some(
        (b) =>
          b.customerId === session.customerId &&
          b.status === 'booked' &&
          b.paymentStatus === 'membership_pending' &&
          (!b.membershipId || b.membershipId === membership.id) &&
          (forGuest ? b.membershipGuest === true : !b.membershipGuest)
      )
    ) {
      return NextResponse.json(
        {
          error: forGuest
            ? 'You already have a guest appointment booked on this plan. Cancel it before booking another.'
            : 'You already have a plan appointment booked on this plan. Cancel it before booking another.',
        },
        { status: 409 }
      );
    }
    const redemptions = await listRedemptions(membership.id);
    const slotAvailable = forGuest
      ? buildGuestWeeks(membership, redemptions).some((w) => w.state === 'available')
      : buildWeeks(membership, redemptions).some((w) => w.state === 'available');
    if (!slotAvailable) {
      return NextResponse.json(
        {
          error: forGuest
            ? "No guest cut left on this plan right now. Unused weeks don't carry over."
            : "No weekly haircut left on this plan right now. Unused weeks don't carry over.",
        },
        { status: 409 }
      );
    }
    const booking: Booking = {
      id: newId(),
      barberId,
      serviceId,
      branchId,
      salonId: salonOf(branch),
      date,
      time,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerId: session.customerId,
      createdAt: new Date().toISOString(),
      status: 'booked',
      paymentIntentId: null,
      paymentStatus: 'membership_pending',
      membershipId: membership.id,
      ...(forGuest ? { membershipGuest: true } : {}),
      amountPaid: 0,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
      servicePrice: finalPrice,
    };
    // Audit H2 (2026-10-22): re-check the slot on a FRESH booking list and
    // claim the start slot before saving, so two simultaneous requests can't
    // both land on the same barber/time. The claim is released if this
    // booking is later cancelled (see bookings/[id]).
    if (hasClash(await listBookings())) {
      return NextResponse.json({ error: 'This time was just booked. Please pick another.' }, { status: 409 });
    }
    if (!(await claimOnce(slotClaimKey))) {
      return NextResponse.json({ error: 'This time was just booked. Please pick another.' }, { status: 409 });
    }
    try {
      await saveBooking(booking);
    } catch (e) {
      await releaseClaim(slotClaimKey);
      throw e;
    }
    // The barber gets a push the moment he has a new haircut.
    void sendPushToUser('barber', barberId, {
      title: 'New booking ✂️',
      body: `${service.name} (${forGuest ? 'plan guest' : 'plan'}) with ${customerName.trim()} — ${date} at ${time}.`,
      url: '/barber/dashboard',
    });
    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: booking.id, date, time, barberName: barber.name, serviceName: service.name,
          price: finalPrice, depositPaid: 0, membership: true, ...(forGuest ? { guest: true } : {}), branchAddress: branch.address,
        },
      },
      { status: 201 }
    );
  }

  // Prepay verification: the $5 booking deposit must have succeeded on
  // Stripe before the booking is saved. The rest is paid at the shop.
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  if (typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_')) {
    return NextResponse.json({ error: 'Payment is required to book.' }, { status: 402 });
  }
  const baseCents = houseCall ? toCents(vipTotalUSD(vipPeople)) : toCents(depositFor(finalPrice));
  // VIP pays in full up front. With surcharging ON its intent authorized
  // base + max card fee (manual capture) and the fee is only settled for
  // CREDIT cards; with the kill-switch OFF the intent is the pre-surcharge
  // shape (automatic capture, plain price). Which shape THIS intent is in
  // is decided from the intent itself in the verification below — never
  // from the current flag — so a flag flip can't strand a paid customer.
  // Deposit intents are never surcharged themselves, in either mode.
  let feeMaxCents = 0; // VIP surcharge-shape only: the authorized max fee
  let vipManualCapture = false; // VIP intent is in the surcharge shape
  let stampedFeeDueCents: number | null = null; // deposit intent's disclosed fee stamp
  let amountPaid: number;
  let stripeCustomerId: string | null = null;
  let stripePaymentMethodId: string | null = null;
  let cardFunding: string | null = null;
  let cardFeeDueCents = 0;
  let cardFeeCollectedCents = 0;
  try {
    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
    const md = intent.metadata ?? {};
    // Dual-shape VIP verification (kill-switch, 2026-10-29), keyed off the
    // intent's own capture method + metadata — not the current flag:
    //  - surcharge shape: manual capture, authorized exactly base + the
    //    metadata-stamped feeMax; normally only AUTHORIZED here
    //    ('requires_capture') and captured below, after the claim.
    //  - pre-surcharge shape: automatic capture of the plain base amount,
    //    already 'succeeded', no fee metadata expectations at all.
    if (houseCall) {
      const metaFee =
        md.baseAmountCents === String(baseCents) && md.feeMaxCents != null
          ? Number(md.feeMaxCents)
          : NaN;
      vipManualCapture =
        intent.capture_method === 'manual' &&
        Number.isInteger(metaFee) &&
        metaFee >= 0 &&
        intent.amount === baseCents + metaFee;
      feeMaxCents = vipManualCapture ? metaFee : 0;
    }
    // A deposit intent stamps the remainder fee its customer was shown at
    // creation ("0" when the switch was off then); the fee due below is
    // capped at that stamp, so an intent created just before an OFF→ON
    // flip can never produce a fee the customer never saw disclosed.
    // Intents predating the stamp leave it null and fall back to the
    // (flag-gated) computation.
    if (!houseCall && md.feeDueCents != null && /^\d+$/.test(md.feeDueCents)) {
      stampedFeeDueCents = Number(md.feeDueCents);
    }
    const statusOk = houseCall
      ? vipManualCapture
        ? intent.status === 'requires_capture' || intent.status === 'succeeded'
        : intent.status === 'succeeded'
      : intent.status === 'succeeded';
    if (!statusOk) {
      return NextResponse.json({ error: 'Payment has not completed. Please try again.' }, { status: 402 });
    }
    if (intent.currency !== 'usd' || intent.amount !== baseCents + feeMaxCents) {
      return NextResponse.json({ error: 'Payment amount mismatch.' }, { status: 402 });
    }
    // Audit H1 (2026-10-22): the intent must have been created FOR this
    // exact booking — kind, customer, Stripe customer, and the
    // barber/service/date/time stamped into its metadata by
    // /api/payments/intent. A succeeded intent for anything else (another
    // customer, another slot, a gift) is not spendable here.
    const expectedKind = houseCall ? 'booking_vip' : 'booking_deposit';
    if (
      md.kind !== expectedKind ||
      md.customerId !== session.customerId ||
      md.barberId !== barberId ||
      md.serviceId !== serviceId ||
      // Audit L12 (2026-10-29): the branch is part of the binding too.
      md.branchId !== branchId ||
      md.date !== date ||
      md.time !== time ||
      !intent.customer ||
      intent.customer !== customer.stripeCustomerId
    ) {
      return NextResponse.json({ error: 'This payment was not made for this booking.' }, { status: 402 });
    }
    // One PaymentIntent pays for exactly one booking — enforced by an
    // atomic claim, not just a scan of existing bookings (audit H1/H2: the
    // scan raced when two requests verified the same intent at once).
    if (!(await claimOnce(`pi-${paymentIntentId}`))) {
      return NextResponse.json({ error: 'This payment was already used.' }, { status: 409 });
    }
    // Saved at deposit time (setup_future_usage) so the barber can collect
    // the remaining balance in the shop by scanning the customer's code.
    // (The H1 binding check above has already proven intent.customer IS
    // this customer's Stripe customer id.)
    stripeCustomerId = customer.stripeCustomerId ?? null;
    stripePaymentMethodId =
      typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id ?? null;
  } catch (e) {
    console.error('Stripe PaymentIntent verify failed', e);
    return NextResponse.json({ error: 'Could not verify the payment. Please try again.' }, { status: 502 });
  }

  if (houseCall && !vipManualCapture) {
    // Pre-surcharge shape: the VIP payment already succeeded at the plain
    // price (automatic capture) — nothing to settle, no fee collected.
    // The saved card's funding is still recorded for the booking record.
    amountPaid = baseCents / 100;
    cardFunding = await fundingForPaymentMethod(stripePaymentMethodId);
    cardFeeCollectedCents = 0;
  } else if (houseCall) {
    // Settle the VIP authorization now that the intent is claimed for this
    // booking: credit cards capture at price + fee, everything else at the
    // plain price (the rest of the hold is released by the capture). While
    // the kill-switch is off, captureByFunding settles at the plain price
    // even for credit cards — no fee is charged.
    let outcome;
    try {
      outcome = await captureByFunding(paymentIntentId, baseCents, feeMaxCents);
    } catch (e) {
      console.error('VIP capture failed', e);
      outcome = null;
    }
    if (
      !outcome ||
      outcome.status !== 'succeeded' ||
      (outcome.capturedCents !== baseCents && outcome.capturedCents !== baseCents + feeMaxCents)
    ) {
      // Release the claim and the customer's card hold — no booking, no charge.
      await releaseClaim(`pi-${paymentIntentId}`);
      try {
        await getStripe().paymentIntents.cancel(paymentIntentId);
      } catch { /* already captured or expired — nothing to release */ }
      return NextResponse.json({ error: 'Payment could not be completed. Please try again.' }, { status: 402 });
    }
    // amountPaid is the service price ONLY — the fee is tracked separately
    // and never enters payouts (payoutForBooking pays $60/person for VIP).
    amountPaid = baseCents / 100;
    cardFunding = outcome.funding;
    cardFeeCollectedCents = outcome.feeCents;
  } else {
    amountPaid = baseCents / 100;
    // Read the saved card's funding: the card processing fee rides on the
    // remaining-balance charge ONLY for credit cards (card-network rules
    // prohibit surcharging debit/prepaid). Fail-safe: any doubt → no fee.
    // Bookings made before this rule have no fee fields and are never
    // charged one — the fee was disclosed to THIS customer at booking.
    // The computation is flag-gated (0 while the kill-switch is off) and
    // capped at the fee stamped on the intent at creation, so the amount
    // due can never exceed what this customer was actually shown.
    cardFunding = await fundingForPaymentMethod(stripePaymentMethodId);
    const computedFeeDue =
      cardFunding === 'credit' ? orderFeeCents(toCents(finalPrice), baseCents).feeCents : 0;
    cardFeeDueCents =
      stampedFeeDueCents !== null ? Math.min(computedFeeDue, stampedFeeDueCents) : computedFeeDue;
  }

  const booking: Booking = {
    id: newId(),
    barberId,
    serviceId,
    branchId,
    salonId: salonOf(branch),
    date,
    time,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerId: session.customerId,
    createdAt: new Date().toISOString(),
    status: 'booked',
    paymentIntentId,
    // A VIP home visit is paid in full at booking time; anything else here
    // is the $5-deposit path ('paid'), the rest collected at the shop.
    paymentStatus: houseCall ? 'paid_in_full' : 'paid',
    amountPaid,
    stripeCustomerId,
    stripePaymentMethodId,
    cardFunding,
    cardFeeDueCents,
    cardFeeCollectedCents,
    servicePrice: finalPrice,
    ...(houseCall ? { houseCall: true, homeAddress, vipPeople, visitNotes: visitNotes || null } : {}),
  };
  // Audit H6 (2026-10-29): every failure exit AFTER the payment was claimed
  // (and, for VIP, captured) must give the money back — the old code
  // returned 409 with the deposit kept / the VIP charge captured and no
  // booking or refund anywhere. Mirrors the orphan-refund path above:
  // refund a succeeded intent (idempotency-keyed), cancel an uncaptured
  // authorization.
  const refundClaimedIntent = async () => {
    await releaseClaim(`pi-${paymentIntentId}`);
    if (!isStripeConfigured()) return;
    try {
      const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
      if (intent.status === 'succeeded') {
        await getStripe().refunds.create(
          { payment_intent: paymentIntentId },
          { idempotencyKey: `refund-clash-${paymentIntentId}` }
        );
      } else if (intent.status === 'requires_capture') {
        await getStripe().paymentIntents.cancel(paymentIntentId).catch(() => {});
      }
    } catch (e) {
      console.error('Post-claim clash refund failed', paymentIntentId, e);
    }
  };
  // Audit H2 (2026-10-22): final guard immediately before saving — fresh
  // list, duration-aware clash check, a scan for this payment on ANY prior
  // booking (covers pre-claim-era records), and the atomic slot claim.
  const fresh = await listBookings();
  if (hasClash(fresh) || fresh.some((b) => b.paymentIntentId === paymentIntentId)) {
    await refundClaimedIntent();
    return NextResponse.json({ error: 'This time was just booked. Please pick another.' }, { status: 409 });
  }
  if (!(await claimOnce(slotClaimKey))) {
    await refundClaimedIntent();
    return NextResponse.json({ error: 'This time was just booked. Please pick another.' }, { status: 409 });
  }
  try {
    await saveBooking(booking);
  } catch (e) {
    await releaseClaim(slotClaimKey);
    await refundClaimedIntent();
    throw e;
  }
  // The barber gets a push the moment he has a new haircut.
  void sendPushToUser('barber', barberId, {
    title: houseCall ? 'New VIP home visit 🏠' : 'New booking ✂️',
    body: houseCall
      ? `Home visit with ${customerName.trim()} — ${date} at ${time}.${vipPeople > 1 ? ` ${vipPeople} people.` : ''} Address: ${homeAddress}${visitNotes ? ` Note: ${visitNotes}` : ''}`
      : `${service.name} with ${customerName.trim()} — ${date} at ${time}.`,
    url: '/barber/dashboard',
  });
  return NextResponse.json(
    { ok: true, booking: { id: booking.id, date, time, barberName: barber.name, serviceName: houseCall ? 'VIP Home Visit' : service.name, price: finalPrice, depositPaid: amountPaid, branchAddress: branch.address, ...(houseCall ? { houseCall: true, homeAddress, vipPeople, visitNotes: visitNotes || undefined } : {}) } },
    { status: 201 }
  );
}
