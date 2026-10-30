import { NextResponse } from 'next/server';
import { getServices, getCustomer, listGifts, saveGift, newId, claimOnce, releaseClaim } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';

import { requireActiveCustomer } from "@/lib/guard";
import { getStripe, isStripeConfigured, toCents } from '@/lib/stripe';
import { captureByFunding, type CaptureOutcome } from '@/lib/cardFee';
import { discountPrice } from '@/lib/discount';
import { randomBytes } from 'node:crypto';
import type { Gift } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeShortCode(existing: Set<string>): string {
  let code = '';
  for (let tries = 0; tries < 20; tries++) {
    // Audit M11 (2026-10-22): 8 chars (was 6) — the code space was small
    // enough to grind. Codes already issued keep their 6 chars and still
    // redeem (lookups are exact-match, length-agnostic).
    const bytes = randomBytes(8);
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

  // The gift must be paid at the buyer's discounted price (if approved).
  const finalPrice = discountPrice(service.price, customer);
  const baseCents = toCents(finalPrice);

  let intent;
  try {
    intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    console.error('Stripe gift retrieve failed', e);
    return NextResponse.json({ error: 'Could not verify the payment.' }, { status: 502 });
  }
  const md = intent.metadata ?? {};
  // Dual-shape verification (kill-switch, 2026-10-29), keyed off the
  // intent's own capture method + metadata — not the current flag — so an
  // intent created just before a flag flip can't strand a paid buyer:
  //  - surcharge shape: manual capture, authorized exactly base + the
  //    metadata-stamped feeMax; a fresh one is 'requires_capture'
  //    (captured below, after the claim), an already-captured retry is
  //    'succeeded'.
  //  - pre-surcharge shape: automatic capture of the plain base amount,
  //    already 'succeeded', no fee metadata expectations.
  // The gift's VALUE is always the base price — the fee is never part of
  // it (see lib/cardFee.ts).
  const metaFee =
    md.baseAmountCents === String(baseCents) && md.feeMaxCents != null
      ? Number(md.feeMaxCents)
      : NaN;
  const manualShape =
    intent.capture_method === 'manual' &&
    Number.isInteger(metaFee) &&
    metaFee >= 0 &&
    intent.amount === baseCents + metaFee;
  const feeMaxCents = manualShape ? metaFee : 0;
  if (
    intent.currency !== 'usd' ||
    (manualShape
      ? intent.status !== 'requires_capture' && intent.status !== 'succeeded'
      : intent.status !== 'succeeded' || intent.amount !== baseCents)
  ) {
    return NextResponse.json({ error: 'Payment did not complete for this service.' }, { status: 402 });
  }
  // Audit H1 (2026-10-22): the intent must have been created FOR a gift, by
  // this customer, for this service (metadata stamped by /api/gifts/intent).
  // Previously ANY succeeded intent of the right amount minted a gift.
  if (md.kind !== 'gift' || md.customerId !== session.customerId || md.serviceId !== serviceId) {
    return NextResponse.json({ error: 'This payment was not made for this gift.' }, { status: 402 });
  }

  // Idempotency: a retry with the same PaymentIntent returns the existing gift.
  const existing = await listGifts();
  const already = existing.find((g) => g.stripePaymentIntentId === paymentIntentId);
  if (already) {
    return NextResponse.json({ ok: true, gift: giftPayload(already) });
  }
  // …and an atomic claim so two simultaneous first-calls can't both mint.
  if (!(await claimOnce(`pi-${paymentIntentId}`))) {
    const raced = (await listGifts()).find((g) => g.stripePaymentIntentId === paymentIntentId);
    if (raced) return NextResponse.json({ ok: true, gift: giftPayload(raced) });
    return NextResponse.json({ error: 'This payment was already used.' }, { status: 409 });
  }

  // Settle the payment now that the intent is claimed for this gift. In
  // the surcharge shape, credit cards capture at price + fee and anything
  // else at the plain price (the capture releases the rest of the hold);
  // while the kill-switch is off, captureByFunding settles at the plain
  // price even for credit cards. In the pre-surcharge shape the payment
  // already succeeded at the plain price — nothing to capture.
  let capture: CaptureOutcome | null;
  if (manualShape) {
    try {
      capture = await captureByFunding(paymentIntentId, baseCents, feeMaxCents);
    } catch (e) {
      console.error('Gift capture failed', e);
      capture = null;
    }
  } else {
    capture = {
      status: 'succeeded',
      capturedCents: intent.amount_received ?? baseCents,
      feeCents: 0,
      funding: 'unknown',
    };
  }
  if (
    !capture ||
    capture.status !== 'succeeded' ||
    (capture.capturedCents !== baseCents && capture.capturedCents !== baseCents + feeMaxCents)
  ) {
    await releaseClaim(`pi-${paymentIntentId}`);
    try {
      await getStripe().paymentIntents.cancel(paymentIntentId);
    } catch { /* already captured or expired — nothing to release */ }
    return NextResponse.json({ error: 'Payment could not be completed. Please try again.' }, { status: 402 });
  }

  const now = new Date();
  const gift: Gift = {
    id: newId(),
    buyerCustomerId: session.customerId,
    buyerName: customer.name,
    recipientName,
    serviceId: service.id,
    serviceName: service.name,
    price: finalPrice,
    cardFeeCents: capture.feeCents,
    status: 'active',
    token: randomBytes(16).toString('hex'),
    shortCode: makeShortCode(new Set(existing.map((g) => g.shortCode))),
    // "Valid 12 months" means 12 calendar months — a flat 365 days would
    // expire a day early across a Feb 29.
    expiresAt: (() => { const e = new Date(now); e.setMonth(e.getMonth() + 12); return e.toISOString(); })(),
    stripePaymentIntentId: paymentIntentId,
    createdAt: now.toISOString(),
    redeemedAt: null,
    redeemedByBarberId: null,
    claimedByCustomerId: null,
    claimedAt: null,
  };
  try {
    await saveGift(gift);
  } catch (e) {
    await releaseClaim(`pi-${paymentIntentId}`);
    throw e;
  }
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
