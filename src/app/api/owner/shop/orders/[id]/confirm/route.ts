import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { getShopOrder, saveShopOrder } from '@/lib/store';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

// Owner: confirm a supply order — the item was handed to the barber.
// From this point the barber can no longer cancel it. For 'earnings'
// orders the debt becomes real now (his next payouts settle it first).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const order = await getShopOrder(id);
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  if (order.status === 'confirmed') return NextResponse.json({ ok: true, already: true, order });
  if (order.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending orders can be confirmed.' }, { status: 409 });
  }
  order.status = 'confirmed';
  order.confirmedAt = new Date().toISOString();
  await saveShopOrder(order);

  // Tell the barber his supply is ready.
  try {
    await sendPushToUser('barber', order.barberId, {
      title: 'Your supply is ready ✓',
      body: `"${order.productName}" was handed over${order.payMethod === 'earnings' ? ` — $${order.priceUsd.toFixed(2)} will be deducted from your earnings` : ''}.`,
      url: '/barber',
    });
  } catch (e) {
    console.error('[shop] confirm push failed', e);
  }
  return NextResponse.json({ ok: true, order });
}
