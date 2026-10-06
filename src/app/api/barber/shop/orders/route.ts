import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';
import {
  getBarbers,
  getShopProduct,
  listShopOrders,
  listShopOrdersByBarber,
  getShopDebt,
  saveShopOrder,
  newId,
  inSalon,
} from '@/lib/store';
import { getStripe, isStripeConfigured, toCents } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Barber: my supply orders + outstanding debt (cancelled orders are hidden).
export async function GET(req: Request) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const orders = (await listShopOrdersByBarber(session.barberId)).filter((o) => o.status !== 'cancelled');
  const debt = await getShopDebt(session.barberId);
  return NextResponse.json({ orders, debt });
}

// Barber: buy a supply product.
// Body: { productId, quantity?, payMethod: 'earnings' | 'card', paymentIntentId? }.
// - 'earnings' (primary): no charge now — the total is deducted from his
//   future payouts once the owner hands the items over.
// - 'card' (secondary): paymentIntentId from a confirmed Stripe payment
//   (card / Apple Pay) is verified before the order is created.
// The order starts as `pending`: the barber can cancel it until the owner
// confirms the handover.
export async function POST(req: Request) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const productId = body?.productId;
  const payMethod = body?.payMethod;
  if (typeof productId !== 'string' || !productId) {
    return NextResponse.json({ error: 'Unknown product.' }, { status: 400 });
  }
  if (payMethod !== 'earnings' && payMethod !== 'card') {
    return NextResponse.json({ error: 'Choose a payment method.' }, { status: 400 });
  }
  const quantity = Math.max(1, Math.min(99, Math.floor(Number(body?.quantity) || 1)));
  const product = await getShopProduct(productId);
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  const salonId = await barberSalonId(session);
  if (!inSalon(product, salonId)) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  if (!product.inStock) {
    return NextResponse.json({ error: 'Out of stock in the shop storage.' }, { status: 409 });
  }
  const total = Math.round(product.priceUsd * quantity * 100) / 100;

  let paymentIntentId: string | null = null;
  if (payMethod === 'card') {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: 'Card payments are not configured yet.' }, { status: 503 });
    }
    const pi = body?.paymentIntentId;
    if (typeof pi !== 'string' || !pi.startsWith('pi_')) {
      return NextResponse.json({ error: 'Card payment did not complete.' }, { status: 402 });
    }
    // One payment per order — a reused intent means "already bought".
    if ((await listShopOrders()).some((o) => inSalon(o, salonId) && o.paymentIntentId === pi)) {
      return NextResponse.json({ error: 'This payment was already used.' }, { status: 409 });
    }
    let intent;
    try {
      intent = await getStripe().paymentIntents.retrieve(pi);
    } catch {
      return NextResponse.json({ error: 'Could not verify the card payment.' }, { status: 502 });
    }
    if (intent.status !== 'succeeded' || intent.amount !== toCents(total) || intent.currency !== 'usd') {
      return NextResponse.json({ error: 'Card payment did not complete for this order.' }, { status: 402 });
    }
    paymentIntentId = pi;
  }

  const me = (await getBarbers()).find((b) => b.id === session.barberId);
  if (!me) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const now = new Date().toISOString();
  const order = {
    id: newId(),
    barberId: me.id,
    barberName: me.name,
    productId: product.id,
    productName: product.name,
    priceUsd: total,
    unitPriceUsd: product.priceUsd,
    quantity,
    photoPath: product.photoPath,
    payMethod,
    paymentIntentId,
    status: 'pending' as const,
    deductedUsd: 0,
    settledKeys: [] as string[],
    confirmedAt: null,
    cancelledAt: null,
    createdAt: now,
    salonId,
  };
  await saveShopOrder(order);
  const debt = await getShopDebt(me.id);
  return NextResponse.json({ ok: true, order, debt });
}
