import { NextResponse } from 'next/server';
import { getBarbers, getServices, getBranches, getCustomer, listBookings, saveBooking, newId, listRedemptions, salonOf } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { requireCustomer } from '@/lib/auth';
import { getStripe, isStripeConfigured, depositFor, toCents } from '@/lib/stripe';
import { buildWeeks, getMembershipById, listActiveMemberships } from '@/lib/membership';
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
  const session = requireCustomer(req);
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
  const barber = barbers.find((b) => b.id === barberId && b.active);
  const service = services.find((s) => s.id === serviceId && s.active);
  const branch = branches.find((b) => b.id === branchId);
  if (!barber || !service || !branch) return NextResponse.json({ error: 'Invalid selection' }, { status: 400 });
  if (!barber.branchIds.includes(branchId)) return NextResponse.json({ error: 'Barber not at this branch' }, { status: 400 });

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
    if (bookings.some((b) => b.customerId === session.customerId && b.status === 'booked' && b.paymentStatus === 'membership_pending' && (!b.membershipId || b.membershipId === membership.id))) {
      return NextResponse.json(
        { error: 'You already have a plan appointment booked on this plan. Cancel it before booking another.' },
        { status: 409 }
      );
    }
    const redemptions = await listRedemptions(membership.id);
    if (!buildWeeks(membership, redemptions).some((w) => w.state === 'available')) {
      return NextResponse.json(
        { error: "No weekly haircut left on this plan right now. Unused weeks don't carry over." },
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
      amountPaid: 0,
      stripeCustomerId: null,
      stripePaymentMethodId: null,
    };
    await saveBooking(booking);
    // The barber gets a push the moment he has a new haircut.
    void sendPushToUser('barber', barberId, {
      title: 'New booking ✂️',
      body: `${service.name} (plan) with ${customerName.trim()} — ${date} at ${time}.`,
      url: '/barber/dashboard',
    });
    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: booking.id, date, time, barberName: barber.name, serviceName: service.name,
          price: service.price, depositPaid: 0, membership: true, branchAddress: branch.address,
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
  const expectedCents = toCents(depositFor(service.price));
  let amountPaid: number;
  let stripeCustomerId: string | null = null;
  let stripePaymentMethodId: string | null = null;
  try {
    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== 'succeeded') {
      return NextResponse.json({ error: 'Payment has not completed. Please try again.' }, { status: 402 });
    }
    if (intent.currency !== 'usd' || intent.amount !== expectedCents) {
      return NextResponse.json({ error: 'Payment amount mismatch.' }, { status: 402 });
    }
    // One PaymentIntent pays for exactly one booking.
    if (bookings.some((b) => b.paymentIntentId === paymentIntentId && b.status === 'booked')) {
      return NextResponse.json({ error: 'This payment was already used.' }, { status: 409 });
    }
    amountPaid = intent.amount / 100;
    // Saved at deposit time (setup_future_usage) so the barber can collect
    // the remaining balance in the shop by scanning the customer's code.
    stripeCustomerId =
      typeof intent.customer === 'string' ? intent.customer : intent.customer?.id ?? null;
    stripePaymentMethodId =
      typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id ?? null;
  } catch (e) {
    console.error('Stripe PaymentIntent verify failed', e);
    return NextResponse.json({ error: 'Could not verify the payment. Please try again.' }, { status: 502 });
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
    paymentStatus: 'paid',
    amountPaid,
    stripeCustomerId,
    stripePaymentMethodId,
  };
  await saveBooking(booking);
  // The barber gets a push the moment he has a new haircut.
  void sendPushToUser('barber', barberId, {
    title: 'New booking ✂️',
    body: `${service.name} with ${customerName.trim()} — ${date} at ${time}.`,
    url: '/barber/dashboard',
  });
  return NextResponse.json(
    { ok: true, booking: { id: booking.id, date, time, barberName: barber.name, serviceName: service.name, price: service.price, depositPaid: amountPaid, branchAddress: branch.address } },
    { status: 201 }
  );
}
