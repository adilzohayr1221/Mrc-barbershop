import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getBooking, saveBooking, getServices, getBarbers } from '@/lib/store';
import { requireCustomer } from '@/lib/auth';
import { remainingFor } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Customer generates a single-use payment code (shown as a QR) for one of
// their bookings. After the haircut the barber scans it to collect the
// remaining balance from the card saved at booking time.
// The token is short-lived (10 minutes) and single-use.
export async function POST(req: Request) {
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const bookingId = body?.bookingId;
  if (typeof bookingId !== 'string' || !bookingId) {
    return NextResponse.json({ error: 'bookingId required' }, { status: 400 });
  }

  const booking = await getBooking(bookingId);
  if (!booking || booking.customerId !== session.customerId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (booking.status !== 'booked') {
    return NextResponse.json({ error: 'This appointment is not active.' }, { status: 409 });
  }
  if (booking.paymentStatus === 'paid_in_full') {
    return NextResponse.json({ error: 'Already paid in full.' }, { status: 409 });
  }

  const [services, barbers] = await Promise.all([getServices(), getBarbers()]);
  const service = services.find((s) => s.id === booking.serviceId);
  if (!service) return NextResponse.json({ error: 'Service not found.' }, { status: 404 });

  const remaining = remainingFor(service.price, booking.amountPaid);
  if (remaining <= 0) {
    return NextResponse.json({ error: 'Nothing left to pay.' }, { status: 409 });
  }
  // Bookings made before cards were saved have no payment method to charge.
  if (!booking.stripeCustomerId || !booking.stripePaymentMethodId) {
    return NextResponse.json(
      { error: 'NO_SAVED_CARD', message: 'No saved card on this booking — please pay the remaining amount at the shop.' },
      { status: 409 }
    );
  }

  const token = randomBytes(24).toString('hex');
  booking.collectToken = token;
  booking.collectTokenExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await saveBooking(booking);

  const barber = barbers.find((b) => b.id === booking.barberId);
  return NextResponse.json({
    ok: true,
    code: `MRC1:${booking.id}:${token}`,
    amount: remaining,
    serviceName: service.name,
    barberName: barber?.name ?? '',
    expiresAt: booking.collectTokenExpiry,
  });
}
