import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getShopOrder, saveShopOrder } from '@/lib/store';
import { getStripe } from '@/lib/stripe';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

// Owner: cancel a supply order (pending or confirmed).
// - pending + card → the card payment is refunded.
// - pending + earnings → voided (no debt existed yet).
// - confirmed + card → refunded (the item is returned).
// - confirmed + earnings → voided; whatever was already deducted from
//   payouts stays deducted, the rest is forgiven.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const order = await getShopOrder(id);
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  if (order.status === 'cancelled') return NextResponse.json({ ok: true, already: true, order });

  let refunded = false;
  if (order.payMethod === 'card' && order.paymentIntentId) {
    try {
      await getStripe().refunds.create({ payment_intent: order.paymentIntentId });
      refunded = true;
    } catch (e) {
      console.error('[shop] owner refund failed', order.id, e);
      return NextResponse.json({ error: 'Could not refund the card payment.' }, { status: 502 });
    }
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date().toISOString();
  await saveShopOrder(order);

  try {
    await sendPushToUser('barber', order.barberId, {
      title: 'Order cancelled',
      body: `Your order for "${order.productName}" was cancelled by the owner${refunded ? ' — your card was refunded' : ''}.`,
      url: '/barber',
    });
  } catch (e) {
    console.error('[shop] cancel push failed', e);
  }
  return NextResponse.json({ ok: true, refunded, order });
}
