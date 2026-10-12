// Student & military discount. Server-side only helpers (the coupon needs
// the Stripe secret key). The discount is 15% off all offers for approved
// customers — applied server-side at every price point (source of truth).
import { getStripe } from './stripe';
import type { Customer } from './types';

/** Discount percentage for verified students and military personnel. */
export const DISCOUNT_PCT = 15;

/** Multiplier applied to prices for approved customers (0.85). */
export const DISCOUNT_MULTIPLIER = (100 - DISCOUNT_PCT) / 100;

/** True when the customer's student/military discount was approved. */
export function hasApprovedDiscount(customer: Pick<Customer, 'discount'> | null | undefined): boolean {
  return !!customer && customer.discount?.status === 'approved';
}

/** Price after the 15% discount (rounded to the cent). No-op without approval. */
export function discountPrice(price: number, customer: Pick<Customer, 'discount'> | null | undefined): number {
  if (!hasApprovedDiscount(customer)) return price;
  return Math.round(price * DISCOUNT_MULTIPLIER * 100) / 100;
}

const COUPON_NAME = 'Student/Military 15%';

/** The shared 15%-off Stripe coupon, created once (idempotent by name). */
export async function getOrCreateDiscountCoupon(): Promise<string> {
  const stripe = getStripe();
  const existing = await stripe.coupons.list({ limit: 100 });
  const found = existing.data.find((c) => c.name === COUPON_NAME && c.percent_off === DISCOUNT_PCT && c.valid);
  if (found) return found.id;
  const coupon = await stripe.coupons.create({
    name: COUPON_NAME,
    percent_off: DISCOUNT_PCT,
    duration: 'forever',
  });
  return coupon.id;
}
