import { NextResponse } from 'next/server';

import { requireActiveCustomer } from "@/lib/guard";
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { getOrCreateYearlyPlanPrice, ensureStripeCustomer } from '@/lib/membership';
import { getOrCreateDiscountCoupon, hasApprovedDiscount } from '@/lib/discount';
import { getCustomer } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Customer-only: start a $1,300/year subscription via Stripe Checkout.
// Same weekly membership as the monthly plan (48 weekly haircuts over
// 12 monthly cycles), billed once a year. Every subscribe creates a new
// subscription, so one account can hold several plans.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  const session = await requireActiveCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  try {
    const stripeCustomerId = await ensureStripeCustomer(session.customerId);
    const priceId = await getOrCreateYearlyPlanPrice();
    const origin = new URL(req.url).origin;
    // Approved student/military customers get 15% off the subscription
    // via a Stripe coupon — applied by Stripe on every invoice, forever
    // (same path as the monthly plan: the yearly invoice is discounted too).
    const customer = await getCustomer(session.customerId);
    const discounts = hasApprovedDiscount(customer)
      ? [{ coupon: await getOrCreateDiscountCoupon() }]
      : undefined;
    const checkout = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      ...(discounts ? { discounts } : {}),
      success_url: `${origin}/customer/offers?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/customer/offers?checkout=cancelled`,
      subscription_data: {
        metadata: { kind: 'membership', planKind: 'yearly', customerId: session.customerId },
        description: 'MRC Master Yearly Plan — unlimited haircuts, one every week. Unused weeks expire.',
      },
      metadata: { kind: 'membership', planKind: 'yearly', customerId: session.customerId },
    });
    return NextResponse.json({ ok: true, url: checkout.url });
  } catch (e) {
    console.error('Yearly membership checkout failed', e);
    return NextResponse.json({ error: 'Could not start the subscription. Please try again.' }, { status: 502 });
  }
}
