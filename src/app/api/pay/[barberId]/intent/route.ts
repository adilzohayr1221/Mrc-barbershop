import { NextResponse } from 'next/server';
import { getBarbers } from '@/lib/store';
import { ensureSeeded } from '@/lib/seed';
import { getStripe, isStripeConfigured, toCents } from '@/lib/stripe';
import { rateLimitExceeded, clientIp } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Create a Stripe PaymentIntent for a walk-in payment to one barber.
// The customer scans the barber's QR code, enters an amount, and pays by
// card, Apple Pay, or bank. No account needed. The client confirms the
// payment with Stripe.js, then calls POST /api/pay/[barberId]/confirm —
// the payment is only recorded (and paid out) after Stripe reports success.
export async function POST(req: Request, { params }: { params: Promise<{ barberId: string }> }) {
  await ensureSeeded();
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  const { barberId } = await params;
  // Audit M12 (2026-10-29): this endpoint is public and creates Stripe
  // intents — throttle intent creation per barber + IP on the shared
  // limiter (20 / 10 min is far above any real walk-in flow).
  if (await rateLimitExceeded(`walkin-intent:${barberId}:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429 });
  }
  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === barberId);
  if (!barber || !barber.active || barber.approved === false || !barber.stripeAccountId) {
    return NextResponse.json({ error: 'This payment page is not available.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const amount = typeof body?.amount === 'number' ? Math.round(body.amount * 100) / 100 : NaN;
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000) {
    return NextResponse.json({ error: 'Enter an amount between $1 and $1,000.' }, { status: 400 });
  }
  const payerName = typeof body?.payerName === 'string' ? body.payerName.trim().slice(0, 60) : '';

  try {
    const intent = await getStripe().paymentIntents.create({
      amount: toCents(amount),
      currency: 'usd',
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        kind: 'walkin',
        barberId: barber.id,
        barberName: barber.name,
        ...(payerName ? { payerName } : {}),
      },
      description: `Walk-in payment to ${barber.name} — MRC Barbershops`,
    });
    return NextResponse.json({ ok: true, clientSecret: intent.client_secret, amount });
  } catch (e) {
    console.error('Stripe walk-in PaymentIntent failed', e);
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }
}
