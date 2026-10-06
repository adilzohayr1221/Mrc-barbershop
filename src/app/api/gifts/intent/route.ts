import { NextResponse } from 'next/server';
import { getServices, getCustomer } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { requireCustomer } from '@/lib/auth';
import { getStripe, isStripeConfigured, toCents } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Create a Stripe PaymentIntent for buying a full-price haircut as a gift.
// The client confirms the payment with Stripe.js, then calls POST
// /api/gifts/purchase with the paymentIntentId — the gift is only created
// after Stripe reports the payment as succeeded. Live keys.
export async function POST(req: Request) {
  await ensureSeeded();
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in to buy a gift.' }, { status: 401 });
  }
  const customer = await getCustomer(session.customerId);
  if (!customer) {
    return NextResponse.json({ error: 'Please log in to buy a gift.' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const serviceId = body?.serviceId;
  if (typeof serviceId !== 'string' || !serviceId) {
    return NextResponse.json({ error: 'serviceId required' }, { status: 400 });
  }

  const services = await getServices();
  const service = services.find((s) => s.id === serviceId && s.active);
  if (!service) return NextResponse.json({ error: 'Invalid service' }, { status: 400 });
  if (service.price <= 0 || toCents(service.price) < 50) {
    return NextResponse.json({ error: 'This service cannot be gifted.' }, { status: 400 });
  }

  try {
    const intent = await getStripe().paymentIntents.create({
      amount: toCents(service.price),
      currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        kind: 'gift',
        serviceId: service.id,
        customerId: session.customerId,
        serviceName: service.name,
      },
      description: `Gift haircut — ${service.name} ($${service.price.toFixed(2)})`,
    });
    return NextResponse.json({ ok: true, clientSecret: intent.client_secret, amount: service.price });
  } catch (e) {
    console.error('Stripe gift PaymentIntent failed', e);
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }
}
