import { NextResponse } from 'next/server';
import { getBooking, saveBooking, deleteBooking, releaseClaim } from '@/lib/store';

import { requireActiveBarber, requireActiveOwner } from "@/lib/guard";
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

// Cancel a booking (soft-cancel: record kept) or mark it as a no-show.
// Owner token may act on any booking; a barber token only on that barber's own.
// Cancelling refunds a prepaid booking automatically. A no-show does NOT
// refund — the deposit is kept.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireActiveOwner(req);
  const barber = owner ? null : await requireActiveBarber(req);
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
  // Audit M1 (2026-10-22): re-PATCHing an already-cancelled booking whose
  // refund FAILED (refundError recorded) is the retry path — it resumes the
  // refund legs below instead of dying on "only active appointments".
  const isRefundRetry =
    booking.status === 'cancelled' && nextStatus === 'cancelled' && !!booking.refundError;
  if (booking.status !== 'booked' && !isRefundRetry)
    return NextResponse.json({ error: 'Only active appointments can be changed' }, { status: 400 });
  // Audit M2 (2026-10-22): a completed booking whose payout already reached
  // the barber can no longer be cancelled or no-showed from here — the
  // refund would pay the customer back on top of the barber's payout
  // (double-pay). Completed-but-unpaid bookings still cancel normally.
  if (
    !isRefundRetry &&
    booking.completedAt &&
    (booking.payoutTransferId || (booking.payoutAmount ?? 0) > 0)
  ) {
    return NextResponse.json(
      { error: 'This haircut was completed and the barber was already paid — it can no longer be cancelled here.' },
      { status: 409 }
    );
  }

  let refundError: string | null = null;
  if (nextStatus === 'cancelled') {
    // Auto-refund prepaid bookings so the customer gets their money back.
    // A fully-paid booking refunds both the deposit and the collected
    // remainder. Each leg is refunded and recorded SEPARATELY: if one leg
    // succeeds and the other fails, the books must show exactly that —
    // paymentStatus only becomes 'refunded' when every leg is refunded,
    // and the failure is stored on the booking (not just returned once),
    // so it can't vanish with the response nobody reads.
    if (booking.paymentStatus === 'paid' || booking.paymentStatus === 'paid_in_full') {
      const legs: { key: 'deposit' | 'remainder'; pi: string }[] = [];
      if (booking.paymentIntentId) legs.push({ key: 'deposit', pi: booking.paymentIntentId });
      if (booking.paymentStatus === 'paid_in_full' && booking.remainingPaymentIntentId) {
        legs.push({ key: 'remainder', pi: booking.remainingPaymentIntentId });
      }
      if (!isStripeConfigured()) {
        // Audit M1: previously this case silently skipped the refund and
        // recorded nothing. Surface it on the booking like any failure.
        refundError = 'The booking was cancelled but Stripe is not configured on the server — refund it manually from the Stripe dashboard.';
        booking.refundError = refundError;
      } else if (legs.length === 0) {
        refundError = 'The booking was cancelled but it has no Stripe payment on record to refund — please check it manually.';
        booking.refundError = refundError;
      } else {
        const stripe = getStripe();
        const doneLegs = new Set(booking.refundedLegs ?? []);
        let anyFailed = false;
        for (const leg of legs) {
          if (doneLegs.has(leg.key)) continue;
          try {
            const refund = await stripe.refunds.create(
              { payment_intent: leg.pi },
              { idempotencyKey: `refund-${booking.id}-${leg.key}` }
            );
            // Audit M1: a created Refund object is not proof of success —
            // only 'succeeded' (or in-flight 'pending') counts as done.
            if (refund.status === 'succeeded' || refund.status === 'pending') {
              doneLegs.add(leg.key);
            } else {
              console.error('Stripe refund not completed', leg.key, refund.status, refund.failure_reason);
              anyFailed = true;
            }
          } catch (e) {
            console.error('Stripe refund failed', leg.key, e);
            anyFailed = true;
          }
        }
        booking.refundedLegs = [...doneLegs];
        if (legs.every((l) => doneLegs.has(l.key))) {
          booking.paymentStatus = 'refunded';
          booking.refundError = null;
        } else if (anyFailed) {
          refundError = 'The booking was cancelled but the automatic refund failed — please refund it manually from the Stripe dashboard.';
          booking.refundError = refundError;
        }
      }
    }
  }
  if (isRefundRetry) {
    // Retry path only: the booking is already cancelled; persist the resumed
    // refund state and report — no status change, no push, no slot change.
    await saveBooking(booking);
    return NextResponse.json({ ok: true, booking, refundError, retried: true });
  }
  // no_show: the deposit is intentionally kept — no refund.
  booking.status = nextStatus;
  await saveBooking(booking);
  // Audit H2: freeing the appointment frees its slot claim, so the start
  // time can be booked again.
  await releaseClaim(`slot-${booking.barberId}-${booking.date}-${booking.time}`);
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
// Refuses to delete anything else (400).
// Audit L3 (2026-10-29): hard deletion is OWNER-only — a barber token may
// cancel / no-show his own bookings (PATCH above) but must not be able to
// erase records.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await requireActiveOwner(req);
  if (!owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const booking = await getBooking(id);
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (booking.status !== 'cancelled' && booking.status !== 'no_show')
    return NextResponse.json({ error: 'Only cancelled or no-show appointments can be deleted' }, { status: 400 });

  await deleteBooking(id);
  return NextResponse.json({ ok: true });
}
