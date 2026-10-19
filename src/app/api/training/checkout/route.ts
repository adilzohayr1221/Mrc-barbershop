import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { getOrCreateTrainingPrice, saveTrainingSignup, type TrainingSignup } from '@/lib/training';

export const dynamic = 'force-dynamic';

// Public: a prospective trainee fills his info, then we hand him to Stripe
// Checkout for the $100/week training subscription. The signup is saved
// first (status "pending") and flipped to "active" by /api/training/verify
// once Stripe confirms the first payment.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const phone = String(body.phone ?? '').trim();
  const dob = String(body.dob ?? '').trim();
  const address = String(body.address ?? '').trim();

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
      createdAt: new Date().toISOString(),
    };
    const customer = await stripe.customers.create({
      name,
      email,
      phone,
      metadata: { kind: 'training', signupId: signup.id, dob, address },
    });
    signup.stripeCustomerId = customer.id;
    const priceId = await getOrCreateTrainingPrice();
    const origin = new URL(req.url).origin;
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/train/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/train?cancelled=1`,
      subscription_data: {
        metadata: { kind: 'training', signupId: signup.id },
        description: 'MRC Barber Training — $100/week',
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
