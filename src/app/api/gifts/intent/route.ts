import { NextResponse } from 'next/server';
import { getServices, getCustomer } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';

import { requireActiveCustomer } from "@/lib/guard";
import { getStripe, isStripeConfigured, toCents } from '@/lib/stripe';
import { surchargeForBaseCents, surchargeEnabled } from '@/lib/cardFee';
import { discountPrice } from '@/lib/discount';

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
  const session = await requireActiveCustomer(req);
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
  // Approved student/military customers buy gifts at the discounted price.
  const finalPrice = discountPrice(service.price, customer);
  if (finalPrice <= 0 || toCents(finalPrice) < 50) {
    return NextResponse.json({ error: 'This service cannot be gifted.' }, { status: 400 });
  }

  // Card processing fee (owner's rule, 2026-10-28 — see lib/cardFee.ts):
  // a gift is paid in full, so the fee rides on this payment — but ONLY
  // for credit cards. With surcharging ON the intent authorizes price +
  // max fee (manual capture, card-only so funding is always readable);
  // the purchase route captures price + fee for credit cards and the
  // plain price otherwise. The buyer sees the "up to" fee BEFORE paying.
  // KILL-SWITCH OFF: the intent is the pre-surcharge shape — plain price,
  // automatic capture, all payment methods, no fee metadata — and
  // feeCents is 0 (the fee math also returns 0 while off).
  const surchargeOn = surchargeEnabled();
  const baseCents = toCents(finalPrice);
  const feeCents = surchargeForBaseCents(baseCents);

  try {
    const intent = await getStripe().paymentIntents.create({
      amount: surchargeOn ? baseCents + feeCents : baseCents,
      currency: 'usd',
      ...(surchargeOn
        ? { capture_method: 'manual' as const, allowed_payment_method_types: ['card' as const] }
        : { automatic_payment_methods: { enabled: true, allow_redirects: 'never' as const } }),
      metadata: {
        kind: 'gift',
        serviceId: service.id,
        customerId: session.customerId,
        serviceName: service.name,
        ...(surchargeOn
          ? { baseAmountCents: String(baseCents), feeMaxCents: String(feeCents) }
          : {}),
      },
      description: `Gift haircut — ${service.name} ($${finalPrice.toFixed(2)})`,
    });
    return NextResponse.json({
      ok: true,
      clientSecret: intent.client_secret,
      amount: finalPrice,
      cardFeeUpTo: feeCents / 100,
    });
  } catch (e) {
    console.error('Stripe gift PaymentIntent failed', e);
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }
}
