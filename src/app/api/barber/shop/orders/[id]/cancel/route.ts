import { NextResponse } from 'next/server';
import { requireBarber } from '@/lib/auth';
import { barberSalonId } from '@/lib/salonScope';
import { getShopOrder, saveShopOrder, getShopDebt, inSalon } from '@/lib/store';
import { getStripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Barber: cancel his own supply order — only while it is still `pending`
// (the owner hasn't handed the item over yet). Card payments are refunded.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const salonId = await barberSalonId(session);
  const order = await getShopOrder(id);
  if (!order || order.barberId !== session.barberId || !inSalon(order, salonId)) {
    return NextResponse.json({ error: 'Order not found.' }, { status: 404 });
  }
  if (order.status === 'cancelled') {
    return NextResponse.json({ ok: true, already: true });
  }
  if (order.status !== 'pending') {
    return NextResponse.json(
      { error: 'This order was already handed over — it can no longer be cancelled.' },
      { status: 409 }
    );
  }

  let refunded = false;
  if (order.payMethod === 'card' && order.paymentIntentId) {
    try {
      await getStripe().refunds.create({ payment_intent: order.paymentIntentId });
      refunded = true;
    } catch (e) {
      console.error('[shop] refund failed', order.id, e);
      return NextResponse.json({ error: 'Could not refund the card payment. Ask the owner.' }, { status: 502 });
    }
  }

  order.status = 'cancelled';
  order.cancelledAt = new Date().toISOString();
  await saveShopOrder(order);
  const debt = await getShopDebt(session.barberId);
  return NextResponse.json({ ok: true, refunded, debt });
}
