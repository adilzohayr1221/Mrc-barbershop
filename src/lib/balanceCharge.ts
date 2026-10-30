import { getBooking, saveBooking, getServices } from '@/lib/store';
import { getStripe, isStripeConfigured, remainingFor, toCents } from '@/lib/stripe';
import { surchargeEnabled } from '@/lib/cardFee';
import { bookingStarted } from '@/lib/earnings';
import { claimOnceStale, releaseClaim } from '@/lib/store';
import type { Booking } from '@/lib/types';

// Audit M2 (2026-10-29): the manual collect flow and this automatic charge
// used different Stripe idempotency keys (`collect-<id>-<token>` vs
// `auto-collect-<id>`), so both could succeed for the same booking. Both
// now take the SAME per-booking charge claim before creating an intent;
// the loser backs off and reconciles from the booking record instead.
// The claim is stealable after 10 minutes so a crashed invocation can't
// wedge the sweep forever.
export const REMAINDER_CLAIM_STALE_MS = 10 * 60 * 1000;
export function remainderClaimKey(bookingId: string): string {
  return `remainder-charge-${bookingId}`;
}

export interface BalanceChargeResult {
  charged: number; // dollars actually charged by this call (0 = nothing charged)
  error?: string; // set when a charge was attempted (or needed) and failed
  noCard?: boolean; // a balance is owed but the booking has no saved card
}

// Automatically charge the remaining balance of a booking to the card the
// customer saved at booking time (off-session). The owner asked for this on
// 2026-10-25: when the barber finishes the haircut, the rest must come off
// the card by itself — the barber takes no cash and scans no code.
//
// Safety:
// - Only fires while paymentStatus === 'paid' (deposit captured, balance
//   outstanding). Membership and VIP bookings never reach this state with a
//   balance (membership is excluded by status; VIP is 'paid_in_full').
// - The PaymentIntent uses the fixed idempotency key `auto-collect-<id>`,
//   and a successful charge flips the booking to 'paid_in_full', so a
//   repeat call is a no-op. If a previous attempt's charge succeeded but
//   its save was lost, the recorded remainingPaymentIntentId is adopted
//   instead of charging again.
// - Failures are recorded on the booking (balanceChargeError) so the barber
//   and owner can see the money is still owed; the manual code-collect flow
//   remains as the fallback.
export async function chargeRemainingBalance(booking: Booking): Promise<BalanceChargeResult> {
  if (booking.paymentStatus !== 'paid') return { charged: 0 };
  // Audit H5 (2026-10-29): never charge before the appointment has started
  // (shop wall clock). The payout sweep already gated payouts on this; the
  // charge now matches — a future booking's card is never touched early.
  if (!bookingStarted(booking)) return { charged: 0 };
  if (!isStripeConfigured()) return { charged: 0 };

  const services = await getServices();
  const service = services.find((s) => s.id === booking.serviceId);
  const totalPrice = booking.servicePrice ?? service?.price;
  if (totalPrice == null) return { charged: 0 };
  const remaining = remainingFor(totalPrice, booking.amountPaid);
  if (remaining <= 0) {
    // Nothing owed (e.g. deposit covered the discounted price) — settle the
    // status so the booking stops looking partially paid.
    booking.paymentStatus = 'paid_in_full';
    booking.balanceChargeError = null;
    await saveBooking(booking);
    return { charged: 0 };
  }

  // Card processing fee still owed on this remainder (credit-card bookings
  // only, disclosed at booking time — see lib/cardFee.ts). It is collected
  // together with the remainder but tracked separately: amountPaid only
  // ever grows by the service-price portion, so payouts never see the fee.
  // Kill-switch: while surcharging is off, no fee is added to the charge —
  // even for a booking created while the switch was on (it carries a
  // stored due, but the switch wins and the fee simply isn't collected).
  const feeDueCents = surchargeEnabled()
    ? Math.max(0, (booking.cardFeeDueCents ?? 0) - (booking.cardFeeCollectedCents ?? 0))
    : 0;

  // Adopt a charge that already succeeded (its save may have been lost).
  if (booking.remainingPaymentIntentId) {
    try {
      const prev = await getStripe().paymentIntents.retrieve(booking.remainingPaymentIntentId);
      if (prev.status === 'succeeded') {
        booking.paymentStatus = 'paid_in_full';
        booking.amountPaid = Math.round(((booking.amountPaid ?? 0) + remaining) * 100) / 100;
        if (booking.cardFeeDueCents != null) {
          booking.cardFeeCollectedCents = booking.cardFeeDueCents;
        }
        booking.balanceChargeError = null;
        await saveBooking(booking);
        return { charged: prev.amount / 100 };
      }
    } catch {
      // Fall through and try a fresh charge under the same idempotency key.
    }
  }

  if (!booking.stripeCustomerId || !booking.stripePaymentMethodId) {
    return {
      charged: 0,
      noCard: true,
      error: 'No saved card on this booking. Collect the remaining amount manually.',
    };
  }

  // Audit M2: take the shared per-booking charge claim before creating an
  // intent, so a manual collect in flight at the same moment can't also
  // succeed. The loser reconciles silently — the winner's save (or the
  // adoption check on the next sweep) settles the booking.
  const claimKey = remainderClaimKey(booking.id);
  if (!(await claimOnceStale(claimKey, REMAINDER_CLAIM_STALE_MS))) {
    const fresh = await getBooking(booking.id);
    if (fresh?.paymentStatus === 'paid_in_full') return { charged: 0 };
    return { charged: 0, error: 'A charge for this booking is already in progress.' };
  }

  try {
    const chargeCents = toCents(remaining) + feeDueCents;
    const pi = await getStripe().paymentIntents.create(
      {
        amount: chargeCents,
        currency: 'usd',
        customer: booking.stripeCustomerId,
        payment_method: booking.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description:
          `MRC Barbershops — remaining $${remaining.toFixed(2)} for ${service?.name ?? 'haircut'} (${booking.date} ${booking.time})` +
          (feeDueCents > 0 ? ` + $${(feeDueCents / 100).toFixed(2)} card processing fee` : ''),
        metadata: {
          kind: 'booking_remaining_auto',
          bookingId: booking.id,
          barberId: booking.barberId,
          ...(feeDueCents > 0 ? { cardFeeCents: String(feeDueCents) } : {}),
        },
      },
      { idempotencyKey: `auto-collect-${booking.id}` }
    );
    if (pi.status !== 'succeeded') {
      await releaseClaim(claimKey);
      booking.balanceChargeError = 'The card needs the customer to approve this charge.';
      await saveBooking(booking);
      return { charged: 0, error: booking.balanceChargeError };
    }
    booking.paymentStatus = 'paid_in_full';
    booking.amountPaid = Math.round(((booking.amountPaid ?? 0) + remaining) * 100) / 100;
    if (feeDueCents > 0) {
      booking.cardFeeCollectedCents = (booking.cardFeeCollectedCents ?? 0) + feeDueCents;
    }
    booking.remainingPaymentIntentId = pi.id;
    booking.balanceChargeError = null;
    booking.collectToken = null;
    booking.collectTokenExpiry = null;
    await saveBooking(booking);
    return { charged: chargeCents / 100 };
  } catch (e: unknown) {
    await releaseClaim(claimKey);
    console.error('[balanceCharge] automatic remaining-balance charge failed', booking.id, e);
    const code = (e as { code?: string })?.code;
    booking.balanceChargeError =
      code === 'authentication_required'
        ? 'The card needs the customer to approve this charge.'
        : 'The automatic charge failed. The remaining amount is still owed.';
    try {
      await saveBooking(booking);
    } catch {}
    return { charged: 0, error: booking.balanceChargeError };
  }
}

// Re-read a booking and charge its remaining balance (used by the payout
// sweep for bookings that were completed before automatic charging existed,
// or whose completion-time attempt failed). Returns the charge result.
export async function chargeRemainingBalanceById(bookingId: string): Promise<BalanceChargeResult> {
  const booking = await getBooking(bookingId);
  if (!booking) return { charged: 0 };
  return chargeRemainingBalance(booking);
}
