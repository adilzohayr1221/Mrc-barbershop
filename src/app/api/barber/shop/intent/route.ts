import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';
import { getBarbers, getShopProduct, inSalon } from '@/lib/store';
import { getStripe, isStripeConfigured, toCents } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Barber: create a Stripe PaymentIntent for a supply product (card / Apple Pay).
// Body: { productId, quantity? }. The client confirms with Stripe.js, then calls
// POST /api/barber/shop/orders with payMethod 'card' + the paymentIntentId.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Card payments are not configured yet.' }, { status: 503 });
  }
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const productId = body?.productId;
  if (typeof productId !== 'string' || !productId) {
    return NextResponse.json({ error: 'Unknown product.' }, { status: 400 });
  }
  const quantity = Math.max(1, Math.min(99, Math.floor(Number(body?.quantity) || 1)));
  const product = await getShopProduct(productId);
  if (!product) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  const salonId = await barberSalonId(session);
  if (!inSalon(product, salonId)) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  if (!product.inStock) {
    return NextResponse.json({ error: 'Out of stock in the shop storage.' }, { status: 409 });
  }
  const me = (await getBarbers()).find((b) => b.id === session.barberId && b.active);
  if (!me) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const total = Math.round(product.priceUsd * quantity * 100) / 100;
  try {
    const intent = await getStripe().paymentIntents.create({
      amount: toCents(total),
      currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        kind: 'shop_order',
        productId: product.id,
        productName: product.name,
        quantity: String(quantity),
        barberId: me.id,
        barberName: me.name,
      },
      description: `MRC Barbershop — supply shop: ${quantity} x ${product.name} ($${total.toFixed(2)})`,
    });
    return NextResponse.json({ ok: true, clientSecret: intent.client_secret, amount: total, quantity });
  } catch (e) {
    console.error('[shop] intent failed', e);
    return NextResponse.json({ error: 'Could not start the card payment.' }, { status: 502 });
  }
}
