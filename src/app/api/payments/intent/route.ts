import { NextResponse } from 'next/server';
import { getBarbers, getServices, getBranches, getCustomer, saveCustomer, listBookings } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { requireCustomer } from '@/lib/auth';
import { getStripe, isStripeConfigured, depositFor, toCents } from '@/lib/stripe';
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
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in to book.' }, { status: 401 });
  }
  const customer = await getCustomer(session.customerId);
  if (!customer) {
    return NextResponse.json({ error: 'Please log in to book.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { barberId, serviceId, branchId, date, time } = body ?? {};
  if (typeof barberId !== 'string' || !barberId) return NextResponse.json({ error: 'barberId required' }, { status: 400 });
  if (typeof serviceId !== 'string' || !serviceId) return NextResponse.json({ error: 'serviceId required' }, { status: 400 });
  if (typeof branchId !== 'string' || !branchId) return NextResponse.json({ error: 'branchId required' }, { status: 400 });
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'Invalid time' }, { status: 400 });

  const [barbers, services, branches, bookings] = await Promise.all([getBarbers(), getServices(), getBranches(), listBookings()]);
  const barber = barbers.find((b) => b.id === barberId && b.active);
  const service = services.find((s) => s.id === serviceId && s.active);
  const branch = branches.find((b) => b.id === branchId);
  if (!barber || !service || !branch) return NextResponse.json({ error: 'Invalid selection' }, { status: 400 });
  if (!barber.branchIds.includes(branchId)) return NextResponse.json({ error: 'Barber not at this branch' }, { status: 400 });

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

  const deposit = depositFor(service.price);
  const amountCents = toCents(deposit);
  if (amountCents < 50) {
    return NextResponse.json({ error: 'This service cannot be booked with a deposit.' }, { status: 400 });
  }

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
      amount: amountCents,
      currency: 'usd',
      customer: stripeCustomerId,
      setup_future_usage: 'off_session',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        barberId,
        serviceId,
        branchId,
        date,
        time,
        customerId: session.customerId,
        serviceName: service.name,
        kind: 'booking_deposit',
      },
      description: `MRC Barbershop — $${deposit.toFixed(2)} booking deposit for ${service.name} with ${barber.name} on ${date} at ${time}`,
    });
    return NextResponse.json({
      ok: true,
      clientSecret: intent.client_secret,
      amount: deposit,
      price: service.price,
      remaining: Math.round((service.price - deposit) * 100) / 100,
    });
  } catch (e) {
    console.error('Stripe PaymentIntent failed', e);
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }
}
