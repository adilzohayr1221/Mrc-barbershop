import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { getOrCreateTrainingPrice, saveTrainingSignup, TRAINING_WEEKLY_OPTIONS, type TrainingSignup, type TrainingWeeklyUsd } from '@/lib/training';
import { rateLimitExceeded, clientIp } from '@/lib/guard';

export const dynamic = 'force-dynamic';

// Public: a prospective trainee fills his info, then we hand him to Stripe
// Checkout for the $100/week training subscription. The signup is saved
// first (status "pending") and flipped to "active" by /api/training/verify
// once Stripe confirms the first payment.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  // Audit L7 (2026-10-29): public endpoint creating Stripe customers +
  // checkout sessions — throttle per IP on the shared limiter.
  if (await rateLimitExceeded(`training-checkout:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  // Plan allowlist: $100/week standard (/train) or $50/week (/train50).
  // Anything else falls back to the standard $100 plan.
  const planRaw = typeof body.plan === 'string' ? Number(body.plan) : body.plan;
  const weeklyUsd: TrainingWeeklyUsd = (TRAINING_WEEKLY_OPTIONS as readonly unknown[]).includes(planRaw)
    ? (planRaw as TrainingWeeklyUsd)
    : 100;
  // Audit L7: field length caps (the values are stored and shown to the owner).
  const name = String(body.name ?? '').trim().slice(0, 80);
  const email = String(body.email ?? '').trim().toLowerCase().slice(0, 120);
  const phone = String(body.phone ?? '').trim().slice(0, 25);
  const dob = String(body.dob ?? '').trim().slice(0, 10);
  const address = String(body.address ?? '').trim().slice(0, 200);

  if (name.length < 2) return NextResponse.json({ error: 'Please enter your full name.' }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  if (phone.length < 5) return NextResponse.json({ error: 'Please enter a valid phone number.' }, { status: 400 });
  const dobDate = new Date(`${dob}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(dobDate.getTime()) || dobDate.getTime() > Date.now()) {
    return NextResponse.json({ error: 'Please enter your date of birth.' }, { status: 400 });
  }
  if (address.length < 5) return NextResponse.json({ error: 'Please enter your home address.' }, { status: 400 });

  try {
    const stripe = getStripe();
    const signup: TrainingSignup = {
      id: randomUUID(),
      name,
      email,
      phone,
      dob,
      address,
      status: 'pending',
      weeklyUsd,
      createdAt: new Date().toISOString(),
    };
    const customer = await stripe.customers.create({
      name,
      email,
      phone,
      // Audit L7 (2026-10-29): date of birth and home address are personal
      // data the shop keeps in its OWN signup record only — they are no
      // longer copied into Stripe metadata.
      metadata: { kind: 'training', signupId: signup.id },
    });
    signup.stripeCustomerId = customer.id;
    const priceId = await getOrCreateTrainingPrice(weeklyUsd);
    const origin = new URL(req.url).origin;
    const planPath = weeklyUsd === 50 ? '/train50' : '/train';
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/train/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${planPath}?cancelled=1`,
      subscription_data: {
        metadata: { kind: 'training', signupId: signup.id },
        description: `MRC Barber Training — $${weeklyUsd}/week`,
      },
      metadata: { kind: 'training', signupId: signup.id },
    });
    signup.sessionId = checkout.id;
    await saveTrainingSignup(signup);
    return NextResponse.json({ ok: true, url: checkout.url });
  } catch (e) {
    console.error('Training checkout failed', e);
    return NextResponse.json({ error: 'Could not start the payment. Please try again.' }, { status: 502 });
  }
}
