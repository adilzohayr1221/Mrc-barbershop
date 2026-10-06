import { NextResponse } from 'next/server';
import { getServices, getCustomer, listGifts, saveGift, newId } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { requireCustomer } from '@/lib/auth';
import { getStripe, isStripeConfigured, toCents } from '@/lib/stripe';
import { randomBytes } from 'node:crypto';
import type { Gift } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeShortCode(existing: Set<string>): string {
  let code = '';
  for (let tries = 0; tries < 20; tries++) {
    const bytes = randomBytes(6);
    code = Array.from(bytes, (b) => SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length]).join('');
    if (!existing.has(code)) return code;
  }
  throw new Error('could not generate a unique short code');
}

// Issue the gift AFTER Stripe confirms the payment succeeded.
// Body: { serviceId, paymentIntentId, recipientName? }.
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
  const paymentIntentId = body?.paymentIntentId;
  const recipientName = typeof body?.recipientName === 'string' && body.recipientName.trim()
    ? body.recipientName.trim().slice(0, 60)
    : null;
  if (typeof serviceId !== 'string' || !serviceId) {
    return NextResponse.json({ error: 'serviceId required' }, { status: 400 });
  }
  if (typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_')) {
    return NextResponse.json({ error: 'paymentIntentId required' }, { status: 400 });
  }

  const services = await getServices();
  const service = services.find((s) => s.id === serviceId && s.active);
  if (!service) return NextResponse.json({ error: 'Invalid service' }, { status: 400 });

  let intent;
  try {
    intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    console.error('Stripe gift retrieve failed', e);
    return NextResponse.json({ error: 'Could not verify the payment.' }, { status: 502 });
  }
  if (
    intent.status !== 'succeeded' ||
    intent.amount !== toCents(service.price) ||
    intent.currency !== 'usd'
  ) {
    return NextResponse.json({ error: 'Payment did not complete for this service.' }, { status: 402 });
  }

  // Idempotency: a retry with the same PaymentIntent returns the existing gift.
  const existing = await listGifts();
  const already = existing.find((g) => g.stripePaymentIntentId === paymentIntentId);
  if (already) {
    return NextResponse.json({ ok: true, gift: giftPayload(already) });
  }

  const now = new Date();
  const gift: Gift = {
    id: newId(),
    buyerCustomerId: session.customerId,
    buyerName: customer.name,
    recipientName,
    serviceId: service.id,
    serviceName: service.name,
    price: service.price,
    status: 'active',
    token: randomBytes(16).toString('hex'),
    shortCode: makeShortCode(new Set(existing.map((g) => g.shortCode))),
    expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    stripePaymentIntentId: paymentIntentId,
    createdAt: now.toISOString(),
    redeemedAt: null,
    redeemedByBarberId: null,
    claimedByCustomerId: null,
    claimedAt: null,
  };
  await saveGift(gift);
  return NextResponse.json({ ok: true, gift: giftPayload(gift) });
}

function giftPayload(g: Gift) {
  return {
    id: g.id,
    serviceName: g.serviceName,
    price: g.price,
    recipientName: g.recipientName,
    shortCode: g.shortCode,
    token: g.token,
    qr: `MRC3:${g.id}:${g.token}`,
    expiresAt: g.expiresAt,
  };
}
