import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { ensureStripeCustomer, customPlanPrice } from '@/lib/membership';
import { getServices } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Customer-only: start a Mix & Match plan — the customer picks 4 services
// (one per week) and the monthly price is computed from their real prices.
// Body: { serviceIds: [id, id, id, id] } — exactly 4, repeats allowed.
// One account can hold several plans (e.g. for family members).
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const serviceIds = body?.serviceIds;
  if (!Array.isArray(serviceIds) || serviceIds.length !== 4 || serviceIds.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'Pick a service for each of the 4 weeks.' }, { status: 400 });
  }
  const services = (await getServices()).filter((s) => s.active);
  const picked = serviceIds.map((id) => services.find((s) => s.id === id));
  if (picked.some((s) => !s)) {
    return NextResponse.json({ error: 'One of the chosen services is no longer available.' }, { status: 400 });
  }
  const price = customPlanPrice(picked.map((s) => s!.price));
  const weeklyServices = picked.map((s) => ({ serviceId: s!.id, name: s!.name, price: s!.price }));
  try {
    const stripeCustomerId = await ensureStripeCustomer(session.customerId);
    const origin = new URL(req.url).origin;
    const weekSummary = weeklyServices.map((w, i) => `W${i + 1}: ${w.name}`).join(', ');
    const checkout = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'MRC Mix & Match Weekly Plan' },
            unit_amount: price * 100,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/customer/offers?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/customer/offers?checkout=cancelled`,
      subscription_data: {
        metadata: {
          kind: 'membership',
          planKind: 'custom',
          customerId: session.customerId,
          planPriceUsd: String(price),
          weeklyServices: JSON.stringify(weeklyServices),
        },
        description: `MRC Mix & Match Plan — ${weekSummary}`,
      },
      metadata: {
        kind: 'membership',
        planKind: 'custom',
        customerId: session.customerId,
        planPriceUsd: String(price),
        weeklyServices: JSON.stringify(weeklyServices),
      },
    });
    return NextResponse.json({ ok: true, url: checkout.url });
  } catch (e) {
    console.error('Custom plan checkout failed', e);
    return NextResponse.json({ error: 'Could not start the subscription. Please try again.' }, { status: 502 });
  }
}
