import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { getOrCreatePlanPrice, ensureStripeCustomer } from '@/lib/membership';
import { getOrCreateDiscountCoupon, hasApprovedDiscount } from '@/lib/discount';
import { getCustomer } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Customer-only: start a $120/month subscription via Stripe Checkout.
// One account can hold several plans (e.g. one for himself, one for his son),
// so every subscribe creates a new subscription.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  try {
    const stripeCustomerId = await ensureStripeCustomer(session.customerId);
    const priceId = await getOrCreatePlanPrice();
    const origin = new URL(req.url).origin;
    // Approved student/military customers get 15% off the subscription
    // via a Stripe coupon — applied by Stripe on every invoice, forever.
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
        metadata: { kind: 'membership', customerId: session.customerId },
        description: 'MRC Monthly Haircut Plan — 4 haircuts, one per week',
      },
      metadata: { kind: 'membership', customerId: session.customerId },
    });
    return NextResponse.json({ ok: true, url: checkout.url });
  } catch (e) {
    console.error('Membership checkout failed', e);
    return NextResponse.json({ error: 'Could not start the subscription. Please try again.' }, { status: 502 });
  }
}
