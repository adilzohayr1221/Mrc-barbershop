import { NextResponse } from 'next/server';
import { getBooking, saveBooking, getServices } from '@/lib/store';
import { requireBarber } from '@/lib/auth';
import { getStripe, isStripeConfigured, remainingFor, toCents } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Barber collects the remaining balance by scanning the customer's payment
// code. Body: { bookingId, token, preview? }.
// - preview=true: verify the code and return the charge summary WITHOUT charging.
// - otherwise: charge the card saved at booking time (off-session) and mark
//   the booking paid in full. The code is single-use and expires in 10 min.
export async function POST(req: Request) {
  const session = requireBarber(req);
  if (!session || !session.barberId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const bookingId = body?.bookingId;
  const token = body?.token;
  const preview = body?.preview === true;
  if (typeof bookingId !== 'string' || !bookingId || typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'Invalid code.' }, { status: 400 });
  }

  const booking = await getBooking(bookingId);
  if (!booking || booking.status !== 'booked') {
    return NextResponse.json({ error: 'Appointment not found or not active.' }, { status: 404 });
  }
  // A barber may only collect for his own appointments.
  if (booking.barberId !== session.barberId) {
    return NextResponse.json({ error: 'This appointment is not yours.' }, { status: 403 });
  }
  if (!booking.collectToken || booking.collectToken !== token) {
    return NextResponse.json(
      { error: 'This code is no longer valid. Ask the customer to show a fresh code.' },
      { status: 403 }
    );
  }
  if (booking.collectTokenExpiry && new Date(booking.collectTokenExpiry).getTime() < Date.now()) {
    return NextResponse.json(
      { error: 'Code expired. Ask the customer to show a fresh code.' },
      { status: 403 }
    );
  }
  if (booking.paymentStatus === 'paid_in_full') {
    return NextResponse.json({ error: 'Already paid in full.' }, { status: 409 });
  }

  const services = await getServices();
  const service = services.find((s) => s.id === booking.serviceId);
  if (!service) return NextResponse.json({ error: 'Service not found.' }, { status: 404 });

  const remaining = remainingFor(service.price, booking.amountPaid);
  if (remaining <= 0) {
    return NextResponse.json({ error: 'Nothing left to pay.' }, { status: 409 });
  }
  if (!booking.stripeCustomerId || !booking.stripePaymentMethodId) {
    return NextResponse.json(
      { error: 'No saved card on this booking. Collect the remaining amount manually.' },
      { status: 409 }
    );
  }

  const summary = {
    customerName: booking.customerName,
    serviceName: service.name,
    date: booking.date,
    time: booking.time,
    amount: remaining,
    depositPaid: booking.amountPaid ?? 0,
    price: service.price,
  };
  if (preview) {
    return NextResponse.json({ ok: true, preview: true, ...summary });
  }

  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: toCents(remaining),
        currency: 'usd',
        customer: booking.stripeCustomerId,
        payment_method: booking.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `MRC Barbershop — remaining $${remaining.toFixed(2)} for ${service.name} (${booking.date} ${booking.time})`,
        metadata: { kind: 'booking_remaining', bookingId: booking.id, barberId: booking.barberId },
      },
      { idempotencyKey: `collect-${booking.id}-${token}` }
    );
    if (pi.status !== 'succeeded') {
      return NextResponse.json(
        { error: 'The card needs the customer to approve this charge. Please collect the remaining amount another way.' },
        { status: 402 }
      );
    }
    booking.paymentStatus = 'paid_in_full';
    booking.amountPaid = Math.round(((booking.amountPaid ?? 0) + remaining) * 100) / 100;
    booking.remainingPaymentIntentId = pi.id;
    booking.collectToken = null;
    booking.collectTokenExpiry = null;
    await saveBooking(booking);
    return NextResponse.json({ ok: true, charged: remaining, ...summary });
  } catch (e: unknown) {
    console.error('Remaining-balance charge failed', e);
    const code = (e as { code?: string })?.code;
    const msg =
      code === 'authentication_required'
        ? 'The card needs the customer to approve this charge. Please collect the remaining amount another way.'
        : 'The charge failed. Please collect the remaining amount another way.';
    return NextResponse.json({ error: msg }, { status: 402 });
  }
}
