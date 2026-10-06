import Stripe from 'stripe';

// Server-side Stripe client. The secret key lives in the STRIPE_SECRET_KEY
// environment variable (set on Vercel) — never in code, never on the client.
let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    stripe = new Stripe(key);
  }
  return stripe;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

// Deposit charged at booking time. The customer pays only this now;
// the rest is paid at the shop.
export const BOOKING_DEPOSIT_USD = 5;

// Deposit for a service price: never more than the price itself, so a
// cheaper-than-deposit service is simply charged in full.
export function depositFor(priceUsd: number): number {
  return Math.min(BOOKING_DEPOSIT_USD, Math.max(0, priceUsd));
}

export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

// Remaining balance on a booking: full service price minus what was paid.
// Never negative.
export function remainingFor(priceUsd: number, amountPaidUsd: number | null | undefined): number {
  const r = Math.round((priceUsd - (amountPaidUsd ?? 0)) * 100) / 100;
  return r > 0 ? r : 0;
}
