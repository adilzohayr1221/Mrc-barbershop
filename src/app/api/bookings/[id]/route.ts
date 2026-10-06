import { NextResponse } from 'next/server';
import { getBooking, saveBooking, deleteBooking } from '@/lib/store';
import { requireOwner, requireBarber } from '@/lib/auth';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

// Cancel a booking (soft-cancel: record kept) or mark it as a no-show.
// Owner token may act on any booking; a barber token only on that barber's own.
// Cancelling refunds a prepaid booking automatically. A no-show does NOT
// refund — the deposit is kept.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = requireOwner(req);
  const barber = owner ? null : requireBarber(req);
  if (!owner && !barber) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (barber && booking.barberId !== barber.barberId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const nextStatus = body?.status;
  if (nextStatus !== 'cancelled' && nextStatus !== 'no_show')
    return NextResponse.json({ error: 'Only cancellation or no-show is supported' }, { status: 400 });
  if (booking.status !== 'booked')
    return NextResponse.json({ error: 'Only active appointments can be changed' }, { status: 400 });

  let refundError: string | null = null;
  if (nextStatus === 'cancelled') {
    // Auto-refund prepaid bookings so the customer gets their money back.
    // A fully-paid booking refunds both the deposit and the collected remainder.
    if (isStripeConfigured() && (booking.paymentStatus === 'paid' || booking.paymentStatus === 'paid_in_full')) {
      try {
        const stripe = getStripe();
        if (booking.paymentIntentId) {
          await stripe.refunds.create({ payment_intent: booking.paymentIntentId });
        }
        if (booking.paymentStatus === 'paid_in_full' && booking.remainingPaymentIntentId) {
          await stripe.refunds.create({ payment_intent: booking.remainingPaymentIntentId });
        }
        booking.paymentStatus = 'refunded';
      } catch (e) {
        console.error('Stripe refund failed', e);
        refundError = 'The booking was cancelled but the automatic refund failed — please refund it manually from the Stripe dashboard.';
      }
    }
  }
  // no_show: the deposit is intentionally kept — no refund.
  booking.status = nextStatus;
  await saveBooking(booking);
  if (booking.customerId) {
    const wasRefunded = booking.paymentStatus === 'refunded';
    void sendPushToUser('customer', booking.customerId, {
      title: nextStatus === 'cancelled' ? 'Appointment cancelled' : 'Marked as no-show',
      body:
        nextStatus === 'cancelled'
          ? `Your appointment on ${booking.date} at ${booking.time} was cancelled.` +
            (wasRefunded ? ' Your payment was refunded.' : '')
          : `You were marked as no-show for ${booking.date} at ${booking.time} — the deposit was not refunded.`,
      url: '/customer/appointments',
    });
  }
  return NextResponse.json({ ok: true, booking, refundError });
}

// Permanently delete a CANCELLED or NO-SHOW booking (hard delete — the record is gone).
// Refuses to delete anything else (400). Owner token may delete any booking;
// a barber token may delete only that barber's own.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = requireOwner(req);
  const barber = owner ? null : requireBarber(req);
  if (!owner && !barber) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (barber && booking.barberId !== barber.barberId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (booking.status !== 'cancelled' && booking.status !== 'no_show')
    return NextResponse.json({ error: 'Only cancelled or no-show appointments can be deleted' }, { status: 400 });

  await deleteBooking(id);
  return NextResponse.json({ ok: true });
}
