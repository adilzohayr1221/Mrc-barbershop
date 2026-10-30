import { getStripe } from './stripe';

// ---------------------------------------------------------------------------
// Card processing fee pass-through ("surcharge") — owner's rule, 2026-10-28:
// when the customer pays the FULL PRICE by card, Stripe's card-processing
// fee is added on top for the customer; when he pays only the $5 booking
// deposit and no-shows, the fee is NOT taken from him — it comes out of
// the $5 (the shop absorbs it, as before).
//
// Compliance design (Maryland + card-network rules — see the build report):
// - Maryland has no statute banning or capping merchant surcharges; the
//   Maryland Consumer Protection Act requires the fee to be disclosed
//   clearly BEFORE payment (it is, as its own line, in the payment UI).
// - Visa/Mastercard PROHIBIT surcharges on debit and prepaid cards — even
//   signature debit. So the fee is applied ONLY when the paying card's
//   funding is 'credit', read from the Stripe PaymentMethod. Anything else
//   (debit, prepaid, non-card methods like ACH/Link, or unknown) is
//   charged the plain price and the shop absorbs the fee, exactly as today.
// - The fee never exceeds the actual Stripe cost and never exceeds 3% of
//   the sale price (Visa's cap since 2023-04-15; Mastercard allows 4%, so
//   the blended program uses the lower 3%). Because the $0.30 fixed part
//   of Stripe's fee cannot always fit under the 3% cap on small tickets,
//   the shop still absorbs a small remainder there — that is the price of
//   staying inside the cap, and it is deliberate.
// - The booking DEPOSIT is never surcharged: a no-show customer loses
//   exactly $5.00, never $5 + fee. The booking's fee rides on the
//   remaining-balance charge, which only happens when the haircut happens.
// - Up-front full payments (VIP, gifts) are created as manual-capture
//   authorizations of (price + max fee); the capture settles at price+fee
//   for credit cards and at the plain price for everything else.
// - Payouts are always computed on the service price (see payouts.ts /
//   vip.ts): the fee is never part of a barber's payout base. Refunds
//   refund the full captured amount (fee included); Stripe does not
//   return its processing fee on refunds, so the shop absorbs that gap —
//   the same economics as refunds today.

export const CARD_FEE_PCT = 0.029; // Stripe US card processing: 2.9%
export const CARD_FEE_FLAT_CENTS = 30; // …plus $0.30 per charge.
export const SURCHARGE_CAP_PCT = 0.03; // Visa surcharge cap: 3% of the sale.

// ---------------------------------------------------------------------------
// KILL-SWITCH (2026-10-29): surcharging is OFF unless the server env var
// SURCHARGE_ENABLED is exactly 'true'. It may only be turned on after the
// 30-day card-network notice period (notice filed 2026-10-29; earliest
// lawful start ≈ 2026-11-28/29) AND the owner's explicit go-live word.
// With the switch off, every fee computation below returns 0 and the
// payment-intent routes build the pre-surcharge intent shapes (automatic
// capture, all payment methods), so a deploy carrying this code charges
// no fee anywhere and behaves exactly like pre-surcharge production.
// Read per call (never cached at module load) so the value always
// reflects the deployed environment.
export function surchargeEnabled(): boolean {
  return process.env.SURCHARGE_ENABLED === 'true';
}

/** Stripe's processing fee (cents) on a charge of `amountCents`. */
export function stripeFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.round(amountCents * CARD_FEE_PCT) + CARD_FEE_FLAT_CENTS;
}

/**
 * Smallest charge total (cents) whose net after Stripe's fee is at least
 * `netTargetCents` — i.e. the grossed-up amount that makes the shop whole.
 */
export function grossUpCents(netTargetCents: number): number {
  if (netTargetCents <= 0) return 0;
  let total = Math.ceil((netTargetCents + CARD_FEE_FLAT_CENTS) / (1 - CARD_FEE_PCT));
  while (total - stripeFeeCents(total) < netTargetCents) total++;
  while (total - 1 - stripeFeeCents(total - 1) >= netTargetCents) total--;
  return total;
}

/**
 * The surcharge (cents) added on top of a single full-price charge of
 * `baseCents`: the exact gross-up fee, capped at 3% of the base price.
 */
export function surchargeForBaseCents(baseCents: number): number {
  if (!surchargeEnabled()) return 0; // kill-switch: no fee while off
  if (baseCents <= 0) return 0;
  const exact = grossUpCents(baseCents) - baseCents;
  const cap = Math.floor(baseCents * SURCHARGE_CAP_PCT);
  return Math.max(0, Math.min(exact, cap));
}

/**
 * Split payment (deposit now, remainder later): the fee that rides on the
 * REMAINDER charge so the shop nets the full price across both charges.
 * The deposit itself is never surcharged (a no-show loses exactly the
 * deposit). Capped at 3% of the FULL price — the cap is measured against
 * the whole sale, not just the remainder.
 */
export function orderFeeCents(
  priceCents: number,
  depositCents: number
): { feeCents: number; remainderChargeCents: number } {
  const remainingCents = Math.max(0, priceCents - depositCents);
  if (!surchargeEnabled() || priceCents <= 0 || remainingCents <= 0) {
    // Kill-switch off → no fee rides on the remainder, ever.
    return { feeCents: 0, remainderChargeCents: remainingCents };
  }
  // The remainder charge must net: price − (deposit − deposit's own fee).
  const remainderNetNeeded = priceCents - (depositCents - stripeFeeCents(depositCents));
  const exactFee = grossUpCents(remainderNetNeeded) - remainingCents;
  const cap = Math.floor(priceCents * SURCHARGE_CAP_PCT);
  const feeCents = Math.max(0, Math.min(exactFee, cap));
  return { feeCents, remainderChargeCents: remainingCents + feeCents };
}

export type CardFunding = 'credit' | 'debit' | 'prepaid' | 'unknown' | 'non_card';

/**
 * Funding of a Stripe payment method, fail-safe: any doubt (non-card
 * method, missing funding, Stripe error) resolves to a NON-surchargable
 * answer, so a fee is only ever added on a positively-identified credit
 * card.
 */
export async function fundingForPaymentMethod(
  paymentMethodId: string | null | undefined
): Promise<CardFunding> {
  if (!paymentMethodId) return 'unknown';
  try {
    const pm = await getStripe().paymentMethods.retrieve(paymentMethodId);
    if (pm.type !== 'card') return 'non_card';
    const f = pm.card?.funding;
    return f === 'credit' || f === 'debit' || f === 'prepaid' ? f : 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface CaptureOutcome {
  status: string;
  capturedCents: number;
  feeCents: number; // captured above the base price (0 unless credit)
  funding: CardFunding;
}

/**
 * Capture a manual-capture PaymentIntent at (base + fee) when the paying
 * card is a CREDIT card, and at the plain base for every other funding.
 * The caller must have already verified the intent was authorized for
 * exactly baseCents + maxFeeCents and belongs to the right purchase.
 * Capturing less than the authorized amount releases the rest of the hold.
 */
export async function captureByFunding(
  paymentIntentId: string,
  baseCents: number,
  maxFeeCents: number
): Promise<CaptureOutcome> {
  const stripe = getStripe();
  const existing = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (existing.status === 'succeeded') {
    // Already captured (a retry after the first capture landed): report
    // what actually arrived instead of capturing twice.
    const captured = existing.amount_received ?? 0;
    return {
      status: existing.status,
      capturedCents: captured,
      feeCents: Math.max(0, captured - baseCents),
      funding: 'unknown',
    };
  }
  if (existing.status !== 'requires_capture') {
    return { status: existing.status, capturedCents: 0, feeCents: 0, funding: 'unknown' };
  }
  const pmId =
    typeof existing.payment_method === 'string'
      ? existing.payment_method
      : existing.payment_method?.id ?? null;
  const funding = await fundingForPaymentMethod(pmId);
  // Kill-switch: with surcharging off, even an intent authorized for
  // base + fee while the switch was on settles at the plain base — the
  // capture releases the fee part of the hold and no fee is charged.
  const feeCents = surchargeEnabled() && funding === 'credit' ? maxFeeCents : 0;
  const captured = await stripe.paymentIntents.capture(paymentIntentId, {
    amount_to_capture: baseCents + feeCents,
  });
  const capturedCents = captured.amount_received ?? baseCents + feeCents;
  return {
    status: captured.status,
    capturedCents,
    feeCents: Math.max(0, capturedCents - baseCents),
    funding,
  };
}
