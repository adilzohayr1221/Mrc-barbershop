import { NextResponse } from 'next/server';
import { getBarbers, getServices, getBranches, getCustomer, saveCustomer, listBookings } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';

import { requireActiveCustomer } from "@/lib/guard";
import { getStripe, isStripeConfigured, depositFor, toCents } from '@/lib/stripe';
import { surchargeForBaseCents, orderFeeCents, surchargeEnabled } from '@/lib/cardFee';
import { discountPrice } from '@/lib/discount';
import { parseVipPeople, vipTotalUSD, vipClash, checkVipServiceArea, VIP_SERVICE_RADIUS_MILES } from '@/lib/vip';
import { shopToday, shopNowTime } from '@/lib/earnings';
import type { WorkingHours } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Create a Stripe PaymentIntent for a booking that is about to be placed.
// The client confirms the payment with Stripe.js, then calls POST /api/bookings
// with the paymentIntentId — the booking is only created after Stripe reports
// the payment as succeeded. Live keys.
export async function POST(req: Request) {
  await ensureSeeded();
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  const session = await requireActiveCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in to book.' }, { status: 401 });
  }
  const customer = await getCustomer(session.customerId);
  if (!customer) {
    return NextResponse.json({ error: 'Please log in to book.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { barberId, serviceId, branchId, date, time } = body ?? {};
  const houseCall = body?.houseCall === true;
  const vipPeople = houseCall ? parseVipPeople(body?.vipPeople) : 1;
  const homeAddress = houseCall && typeof body?.homeAddress === 'string' ? body.homeAddress.trim() : '';
  if (typeof barberId !== 'string' || !barberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 });
  if (typeof serviceId !== 'string' || !serviceId) return NextResponse.json({ error: 'serviceId required' }, { status: 400 });
  if (typeof branchId !== 'string' || !branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 });
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'Invalid time' }, { status: 400 });

  const [barbers, services, branches, bookings] = await Promise.all([getBarbers(), getServices(), getBranches(), listBookings()]);
  // Audit M5 (2026-10-29): unapproved self-signup barbers cannot take payments.
  const barber = barbers.find((b) => b.id === barberId && b.active && b.approved !== false);
  const service = services.find((s) => s.id === serviceId && s.active);
  const branch = branches.find((b) => b.id === branchId);
  if (!barber || !service || !branch) return NextResponse.json({ error: 'Invalid selection' }, { status: 400 });
  if (!barber.branchIds.includes(branchId)) return NextResponse.json({ error: 'Barber not at this branch' }, { status: 400 });

  // Audit M6 (2026-10-22): never create a PaymentIntent for a slot that has
  // already started (shop-local wall clock) — mirror of the bookings POST
  // check, applied BEFORE any money can move so no orphan payment is born.
  const todayStr = shopToday();
  if (date < todayStr || (date === todayStr && time <= shopNowTime())) {
    return NextResponse.json({ error: 'This time has already passed. Please pick a later time.' }, { status: 400 });
  }

  if (barber.workingHours) {
    const dayKey = String(new Date(date + 'T12:00:00').getDay()) as keyof WorkingHours;
    const hours = barber.workingHours[dayKey];
    const slotHour = time.slice(0, 2) + ':00';
    if (!hours || !hours.includes(slotHour)) {
      return NextResponse.json({ error: 'This barber is not working at the selected time.' }, { status: 400 });
    }
  }
  if (bookings.some((b) => b.barberId === barberId && b.date === date && b.time === time && b.status === 'booked')) {
    return NextResponse.json({ error: 'This time was just booked. Please pick another.' }, { status: 409 });
  }
  // A VIP home visit blocks 2 hours of the barber's day (and needs its own
  // 2-hour window free) — checked before any money moves. Normal bookings
  // block their service's full duration (audit M7).
  const durationByService = new Map(services.map((s) => [s.id, s.durationMin]));
  if (vipClash(bookings, barberId, date, time, houseCall, service.durationMin, (b) => durationByService.get(b.serviceId) ?? 30)) {
    return NextResponse.json({ error: 'This time was just booked. Please pick another.' }, { status: 409 });
  }

  // VIP home visit: flat $100 per person, paid in full at booking time, only
  // from barbers who opted in to house calls. No deposit split, no discount.
  if (houseCall && barber.houseCalls !== true) {
    return NextResponse.json({ error: 'This barber does not offer home visits.' }, { status: 400 });
  }
  // Service area: the home must be within the radius of the branch, checked
  // before any payment is taken.
  if (houseCall) {
    if (homeAddress.length < 8) {
      return NextResponse.json({ error: 'Please enter your full home address for the visit.' }, { status: 400 });
    }
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
  // Approved student/military customers pay the discounted price (server-side).
  const finalPrice = houseCall ? vipTotalUSD(vipPeople) : discountPrice(service.price, customer);
  const deposit = houseCall ? vipTotalUSD(vipPeople) : depositFor(finalPrice);
  const amountCents = toCents(deposit);
  if (amountCents < 50) {
    return NextResponse.json({ error: 'This service cannot be booked with a deposit.' }, { status: 400 });
  }

  // Card processing fee (owner's rule, 2026-10-28 — see lib/cardFee.ts):
  // the fee a CREDIT card may add. For a deposit booking it rides on the
  // remaining-balance charge (the deposit itself is never surcharged, so
  // a no-show always loses exactly the deposit); for a VIP visit paid in
  // full it rides on this payment. The client shows it BEFORE payment as
  // an "up to" amount — the actual fee depends on the card's funding,
  // which is only known once the card is used. Debit/prepaid: no fee.
  // KILL-SWITCH: while surchargeEnabled() is false every fee below is 0
  // and the VIP intent keeps the pre-surcharge shape (automatic capture,
  // all payment methods) — the fee math itself also returns 0 while off.
  const surchargeOn = surchargeEnabled();
  const cardFeeCents = houseCall
    ? surchargeForBaseCents(amountCents)
    : orderFeeCents(toCents(finalPrice), amountCents).feeCents;

  // The remaining balance is collected in the shop after the haircut: the
  // barber scans the customer's payment code and the saved card is charged.
  // So the card used for the deposit is saved (with the customer's consent,
  // disclosed on the payment screen) for a later off-session charge.
  let stripeCustomerId = customer.stripeCustomerId ?? null;
  try {
    if (stripeCustomerId) {
      try {
        await getStripe().customers.retrieve(stripeCustomerId);
      } catch {
        stripeCustomerId = null; // was deleted on Stripe's side — recreate below
      }
    }
    if (!stripeCustomerId) {
      const sc = await getStripe().customers.create({
        email: customer.email,
        name: customer.name,
        metadata: { customerId: customer.id },
      });
      stripeCustomerId = sc.id;
      await saveCustomer({ ...customer, stripeCustomerId });
    }
  } catch (e) {
    console.error('Stripe customer setup failed', e);
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }

  try {
    const intent = await getStripe().paymentIntents.create({
      // VIP (paid in full) with surcharging ON: authorize price + max fee,
      // then capture by card funding when the booking is created (credit →
      // price + fee, anything else → plain price). Card-only so every
      // offered method carries a readable funding type and supports manual
      // capture; Apple Pay / Google Pay still ride on 'card'.
      // With surcharging OFF (kill-switch), and for deposit bookings in
      // both modes: automatic capture of the plain amount, all methods —
      // exactly the pre-surcharge shape.
      amount: houseCall && surchargeOn ? amountCents + cardFeeCents : amountCents,
      currency: 'usd',
      customer: stripeCustomerId,
      setup_future_usage: 'off_session',
      ...(houseCall && surchargeOn
        ? { capture_method: 'manual' as const, allowed_payment_method_types: ['card' as const] }
        : { automatic_payment_methods: { enabled: true, allow_redirects: 'never' as const } }),
      metadata: {
        barberId,
        serviceId,
        branchId,
        date,
        time,
        customerId: session.customerId,
        serviceName: service.name,
        kind: houseCall ? 'booking_vip' : 'booking_deposit',
        ...(houseCall
          ? surchargeOn
            ? { baseAmountCents: String(amountCents), feeMaxCents: String(cardFeeCents) }
            : {}
          : // The deposit's disclosed remainder fee ("0" while the switch
            // is off) is stamped on the intent so the booking route can
            // key what THIS customer was shown off the intent itself —
            // an intent created just before a flag flip can never produce
            // an undisclosed fee (see api/bookings).
            { feeDueCents: String(cardFeeCents) }),
      },
      description: houseCall
        ? `MRC Barbershops — $${deposit.toFixed(2)} VIP home visit (${service.name}) with ${barber.name} on ${date} at ${time}${vipPeople > 1 ? ` — ${vipPeople} people` : ''}`
        : `MRC Barbershops — $${deposit.toFixed(2)} booking deposit for ${service.name} with ${barber.name} on ${date} at ${time}`,
    });
    return NextResponse.json({
      ok: true,
      clientSecret: intent.client_secret,
      amount: deposit,
      price: finalPrice,
      remaining: Math.round((finalPrice - deposit) * 100) / 100,
      cardFeeUpTo: cardFeeCents / 100,
    });
  } catch (e) {
    console.error('Stripe PaymentIntent failed', e);
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }
}
