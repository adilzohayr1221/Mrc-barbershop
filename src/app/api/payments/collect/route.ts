import { NextResponse } from 'next/server';
import { getBooking, saveBooking, getServices, claimOnceStale, releaseClaim } from '@/lib/store';
import { requireActiveBarber } from '@/lib/guard';
import { getStripe, isStripeConfigured, remainingFor, toCents } from '@/lib/stripe';
import { remainderClaimKey, REMAINDER_CLAIM_STALE_MS } from '@/lib/balanceCharge';
import { surchargeEnabled } from '@/lib/cardFee';

export const dynamic = 'force-dynamic';

// Barber collects the remaining balance by scanning the customer's payment
// code. Body: { bookingId, token, preview? }.
// - preview=true: verify the code and return the charge summary WITHOUT charging.
// - otherwise: charge the card saved at booking time (off-session) and mark
//   the booking paid in full. The code is single-use and expires in 10 min.
export async function POST(req: Request) {
  const session = await requireActiveBarber(req);
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

  // The remaining balance is computed from the price agreed at booking time
  // (discounted for approved student/military customers).
  const totalPrice = booking.servicePrice ?? service.price;
  const remaining = remainingFor(totalPrice, booking.amountPaid);
  if (remaining <= 0) {
    return NextResponse.json({ error: 'Nothing left to pay.' }, { status: 409 });
  }
  if (!booking.stripeCustomerId || !booking.stripePaymentMethodId) {
    return NextResponse.json(
      { error: 'No saved card on this booking. Collect the remaining amount manually.' },
      { status: 409 }
    );
  }

  // Card processing fee still owed on this remainder (credit-card bookings
  // only, disclosed at booking — see lib/cardFee.ts). Shown in the preview
  // so the amount about to be charged is never a surprise; tracked
  // separately from amountPaid so payouts never include it.
  // Kill-switch: while surcharging is off, no fee is added (and the
  // preview shows none) — even for a booking created while it was on.
  const feeDueCents = surchargeEnabled()
    ? Math.max(0, (booking.cardFeeDueCents ?? 0) - (booking.cardFeeCollectedCents ?? 0))
    : 0;
  const chargeCents = toCents(remaining) + feeDueCents;

  const summary = {
    customerName: booking.customerName,
    serviceName: service.name,
    date: booking.date,
    time: booking.time,
    amount: remaining,
    cardFee: feeDueCents / 100,
    totalCharge: chargeCents / 100,
    depositPaid: booking.amountPaid ?? 0,
    price: totalPrice,
  };
  if (preview) {
    return NextResponse.json({ ok: true, preview: true, ...summary });
  }

  // Audit M2 (2026-10-29): take the shared per-booking charge claim before
  // creating the intent — the automatic charge (lib/balanceCharge) takes
  // the same claim, so the two paths can no longer both succeed. The
  // Stripe idempotency key stays `collect-<id>-<token>` (in-flight
  // retries keep their original protection).
  const claimKey = remainderClaimKey(booking.id);
  if (!(await claimOnceStale(claimKey, REMAINDER_CLAIM_STALE_MS))) {
    const fresh = await getBooking(booking.id);
    if (fresh?.paymentStatus === 'paid_in_full') {
      return NextResponse.json({ error: 'Already paid in full.' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'A charge for this booking is already in progress. Please try again in a moment.' },
      { status: 409 }
    );
  }

  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: chargeCents,
        currency: 'usd',
        customer: booking.stripeCustomerId,
        payment_method: booking.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description:
          `MRC Barbershops — remaining $${remaining.toFixed(2)} for ${service.name} (${booking.date} ${booking.time})` +
          (feeDueCents > 0 ? ` + $${(feeDueCents / 100).toFixed(2)} card processing fee` : ''),
        metadata: {
          kind: 'booking_remaining',
          bookingId: booking.id,
          barberId: booking.barberId,
          ...(feeDueCents > 0 ? { cardFeeCents: String(feeDueCents) } : {}),
        },
      },
      { idempotencyKey: `collect-${booking.id}-${token}` }
    );
    if (pi.status !== 'succeeded') {
      await releaseClaim(claimKey);
      return NextResponse.json(
        { error: 'The card needs the customer to approve this charge. Please collect the remaining amount another way.' },
        { status: 402 }
      );
    }
    booking.paymentStatus = 'paid_in_full';
    booking.amountPaid = Math.round(((booking.amountPaid ?? 0) + remaining) * 100) / 100;
    if (feeDueCents > 0) {
      booking.cardFeeCollectedCents = (booking.cardFeeCollectedCents ?? 0) + feeDueCents;
    }
    booking.remainingPaymentIntentId = pi.id;
    booking.collectToken = null;
    booking.collectTokenExpiry = null;
    await saveBooking(booking);
    // Audit H3 (2026-10-22): if the haircut was already marked Done, its
    // payout covered only what was collected then (the $5 deposit) and the
    // rest was stranded. Pay the remainder leg now that the money is in;
    // the payout sweep retries it if this attempt fails. (If Done comes
    // later instead, it pays the full collected amount itself.)
    if (booking.completedAt) {
      try {
        const { payoutToBarber } = await import('@/lib/payouts');
        const { payoutForBooking } = await import('@/lib/vip');
        const { bookingStarted } = await import('@/lib/earnings');
        const owed = payoutForBooking(booking);
        const already = booking.payoutAmount ?? 0;
        if (bookingStarted(booking) && owed > already) {
          const res = await payoutToBarber(booking.barberId, Math.round((owed - already) * 100) / 100, {
            idempotencyKey: `payout-booking-${booking.id}-remainder`,
            description: `MRC Barbershops — haircut payout, remainder (${booking.date} ${booking.time})`,
            metadata: { kind: 'booking_payout', bookingId: booking.id, leg: 'remainder' },
          });
          if (res.ok) {
            booking.payoutAmount = owed;
            if (!booking.payoutTransferId) booking.payoutTransferId = res.transferId ?? null;
            await saveBooking(booking);
          } else {
            console.error('[collect] remainder payout failed — sweep will retry', booking.id, res.error);
          }
        }
      } catch (e) {
        console.error('[collect] remainder payout failed — sweep will retry', booking.id, e);
      }
    }
    return NextResponse.json({ ok: true, charged: chargeCents / 100, ...summary });
  } catch (e: unknown) {
    await releaseClaim(claimKey);
    console.error('Remaining-balance charge failed', e);
    const code = (e as { code?: string })?.code;
    const msg =
      code === 'authentication_required'
        ? 'The card needs the customer to approve this charge. Please collect the remaining amount another way.'
        : 'The charge failed. Please collect the remaining amount another way.';
    return NextResponse.json({ error: msg }, { status: 402 });
  }
}
