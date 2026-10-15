import { NextResponse } from 'next/server';
import { getBarbers, listWalkinPayments, saveWalkinPayment, newId } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { getStripe, isStripeConfigured } from '@/lib/stripe';
import type { WalkinPayment } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Record a walk-in payment after the customer paid, and pay the barber.
// Verified against Stripe (never trusts the client): the PaymentIntent
// must be succeeded, belong to this barber, and be a walk-in payment.
// Idempotent on paymentIntentId — a retried confirm never double-records
// or double-pays. 100% goes to the barber (the $0.25 bank-payout fee is
// deducted inside payoutToBarber, as everywhere else). If the transfer
// fails (e.g. Stripe has not released the funds yet), the payment is
// recorded with payoutFailed and the retry sweep keeps trying.
export async function POST(req: Request, { params }: { params: Promise<{ barberId: string }> }) {
  await ensureSeeded();
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  const { barberId } = await params;
  const body = await req.json().catch(() => null);
  const paymentIntentId = typeof body?.paymentIntentId === 'string' ? body.paymentIntentId : '';
  if (!paymentIntentId) {
    return NextResponse.json({ error: 'paymentIntentId required' }, { status: 400 });
  }

  // Already recorded? Return the existing outcome — never pay twice.
  const existing = (await listWalkinPayments()).find((w) => w.paymentIntentId === paymentIntentId);
  if (existing) {
    return NextResponse.json({ ok: true, amount: existing.amount, payoutFailed: existing.payoutFailed ?? false });
  }

  let amount: number;
  let payerName: string | null = null;
  try {
    const pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') {
      return NextResponse.json({ error: 'Payment has not completed.' }, { status: 402 });
    }
    if (pi.metadata?.kind !== 'walkin' || pi.metadata?.barberId !== barberId) {
      return NextResponse.json({ error: 'Payment does not match this barber.' }, { status: 400 });
    }
    amount = pi.amount / 100;
    payerName = pi.metadata?.payerName ? String(pi.metadata.payerName).slice(0, 60) : null;
  } catch (e) {
    console.error('Walk-in payment verify failed', e);
    return NextResponse.json({ error: 'Could not verify the payment.' }, { status: 502 });
  }

  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === barberId);
  if (!barber) return NextResponse.json({ error: 'Barber not found.' }, { status: 404 });

  const payment: WalkinPayment = {
    id: newId(),
    salonId: barber.salonId,
    barberId,
    amount,
    payerName,
    paymentIntentId,
    payoutTransferId: null,
    payoutFailed: false,
    createdAt: new Date().toISOString(),
  };
  try {
    const { payoutToBarber } = await import('@/lib/payouts');
    const result = await payoutToBarber(barberId, amount, {
      idempotencyKey: `payout-walkin-${payment.id}`,
      description: `MRC Barbershop — walk-in payment ($${amount.toFixed(2)})`,
      metadata: { kind: 'walkin_payout', walkinId: payment.id },
    });
    if (result.ok) {
      payment.payoutTransferId = result.transferId ?? null;
    } else {
      payment.payoutFailed = true;
    }
  } catch (e) {
    payment.payoutFailed = true;
    console.error('[walkin] payout failed', e);
  }
  await saveWalkinPayment(payment);
  return NextResponse.json({ ok: true, amount, payoutFailed: payment.payoutFailed ?? false });
}
