import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import {
  getBooking, getRedemption, listTips, saveTip, newId, listBookings,
} from '@/lib/store';
import { getMembershipById } from '@/lib/membership';
import { getStripe, isStripeConfigured, toCents } from '@/lib/stripe';
import type { Tip } from '@/lib/types';

export const dynamic = 'force-dynamic';

// POST /api/tips — customer tips (بقشيش) the barber after a haircut.
// Body: { ref: 'booking:<id>' | 'redemption:<id>', amount: dollars }.
// The tip is charged off-session on the customer's saved card and 100% goes
// to the barber immediately. One tip per haircut.
export async function POST(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 });
  }
  const body = await req.json().catch(() => null);
  const ref = typeof body?.ref === 'string' ? body.ref : '';
  const amount = Number(body?.amount);
  if (!ref || !Number.isFinite(amount) || amount < 1 || amount > 100) {
    return NextResponse.json({ error: 'Pick a tip between $1 and $100.' }, { status: 400 });
  }
  const tipAmount = Math.round(amount * 100) / 100;
  const [kind, id] = ref.split(':');
  if (!kind || !id || (kind !== 'booking' && kind !== 'redemption')) {
    return NextResponse.json({ error: 'Invalid reference.' }, { status: 400 });
  }

  // Resolve the haircut: barber, owning customer, and a chargeable card.
  let barberId: string | null = null;
  let stripeCustomer: string | null = null;
  let paymentMethod: string | null = null;
  let source: Tip['source'];
  let sourceId: string;
  let serviceName = 'Haircut';

  if (kind === 'booking') {
    const b = await getBooking(id);
    if (!b || b.customerId !== session.customerId || !b.completedAt) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    barberId = b.barberId;
    stripeCustomer = b.stripeCustomerId ?? null;
    paymentMethod = b.stripePaymentMethodId ?? null;
    source = 'booking';
    sourceId = b.id;
  } else {
    const r = await getRedemption(id);
    if (!r || r.customerId !== session.customerId) {
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    }
    const m = await getMembershipById(r.membershipId);
    if (!m?.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No saved card for tipping.' }, { status: 409 });
    }
    barberId = r.barberId;
    source = 'redemption';
    sourceId = r.id;
    if (m.planKind === 'custom') {
      const ws = m.weeklyServices?.[r.weekIndex];
      if (ws) serviceName = ws.name;
    }
    // Charge the subscription's default payment method.
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(m.stripeSubscriptionId);
      const custId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
      stripeCustomer = custId;
      const cust = await stripe.customers.retrieve(custId);
      if (!('deleted' in cust)) {
        const def = cust.invoice_settings?.default_payment_method;
        paymentMethod = typeof def === 'string' ? def : def?.id ?? null;
      }
    } catch (e) {
      console.error('[tip] subscription card lookup failed', e);
    }
  }

  if (!barberId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  // Gift recipients tip from a saved card on one of their own bookings, if any.
  if (!stripeCustomer || !paymentMethod) {
    if (kind === 'booking') {
      return NextResponse.json({ error: 'No saved card on this booking. Tip in cash instead.' }, { status: 409 });
    }
    const mine = (await listBookings()).filter(
      (b) => b.customerId === session.customerId && b.stripeCustomerId && b.stripePaymentMethodId
    );
    const latest = mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!latest?.stripeCustomerId || !latest?.stripePaymentMethodId) {
      return NextResponse.json({ error: 'No saved card for tipping. Tip in cash instead.' }, { status: 409 });
    }
    stripeCustomer = latest.stripeCustomerId;
    paymentMethod = latest.stripePaymentMethodId;
  }

  // One tip per haircut.
  if ((await listTips()).some((t) => t.source === source && t.sourceId === sourceId)) {
    return NextResponse.json({ error: 'You already tipped for this haircut. Thank you!' }, { status: 409 });
  }

  // Charge the tip off-session.
  let piId: string;
  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: toCents(tipAmount),
        currency: 'usd',
        customer: stripeCustomer!,
        payment_method: paymentMethod!,
        off_session: true,
        confirm: true,
        description: `MRC Barbershop — $${tipAmount.toFixed(2)} tip for ${serviceName}`,
        metadata: { kind: 'tip', source, sourceId, barberId },
      },
      { idempotencyKey: `tip-${source}-${sourceId}` }
    );
    if (pi.status !== 'succeeded') {
      return NextResponse.json(
        { error: 'The card needs you to approve this charge. Tip in cash instead.' },
        { status: 402 }
      );
    }
    piId = pi.id;
  } catch (e) {
    console.error('[tip] charge failed', e);
    const code = (e as { code?: string })?.code;
    return NextResponse.json(
      {
        error:
          code === 'authentication_required'
            ? 'The card needs you to approve this charge. Tip in cash instead.'
            : 'The tip charge failed. Tip in cash instead.',
      },
      { status: 402 }
    );
  }

  // 100% of the tip goes to the barber immediately.
  const tip: Tip = {
    id: newId(),
    barberId,
    customerId: session.customerId,
    amount: tipAmount,
    source,
    sourceId,
    paymentIntentId: piId,
    payoutTransferId: null,
    payoutFailed: false,
    createdAt: new Date().toISOString(),
  };
  try {
    const { payoutToBarber } = await import('@/lib/payouts');
    const result = await payoutToBarber(barberId, tipAmount, {
      idempotencyKey: `payout-tip-${tip.id}`,
      description: `MRC Barbershop — customer tip ($${tipAmount.toFixed(2)})`,
      metadata: { kind: 'tip_payout', tipId: tip.id },
    });
    if (result.ok) {
      tip.payoutTransferId = result.transferId ?? null;
    } else {
      tip.payoutFailed = true;
    }
  } catch (e) {
    tip.payoutFailed = true;
    console.error('[tip] payout failed', e);
  }
  await saveTip(tip);
  return NextResponse.json({ ok: true, tipped: tipAmount, payoutFailed: tip.payoutFailed ?? false });
}
