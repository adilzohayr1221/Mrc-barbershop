import { NextResponse } from 'next/server';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { getTrainingSignupBySession, saveTrainingSignup } from '@/lib/training';

export const dynamic = 'force-dynamic';

// Public (the caller proves himself by holding the checkout session id):
// after Stripe Checkout redirects back, flip the signup to "active" once
// Stripe confirms the first weekly payment landed.
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('session_id') ?? '';
  if (!sessionId) return NextResponse.json({ error: 'Missing session.' }, { status: 400 });
  const signup = await getTrainingSignupBySession(sessionId);
  if (!signup) return NextResponse.json({ error: 'Signup not found.' }, { status: 404 });
  if (signup.status === 'active') {
    return NextResponse.json({ ok: true, active: true, name: signup.name, weeklyUsd: signup.weeklyUsd ?? 100 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: true, active: false, name: signup.name, weeklyUsd: signup.weeklyUsd ?? 100 });
  }
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    // Audit M12 (2026-10-22): activation requires money actually paid —
    // a 'complete' session can exist with payment_status 'unpaid' (e.g. a
    // delayed/failed first charge), which previously activated for free.
    const paid = session.payment_status === 'paid';
    if (paid) {
      signup.status = 'active';
      signup.paidAt = new Date().toISOString();
      if (typeof session.subscription === 'string') signup.subscriptionId = session.subscription;
      await saveTrainingSignup(signup);
      return NextResponse.json({ ok: true, active: true, name: signup.name, weeklyUsd: signup.weeklyUsd ?? 100 });
    }
    return NextResponse.json({ ok: true, active: false, name: signup.name, weeklyUsd: signup.weeklyUsd ?? 100 });
  } catch (e) {
    console.error('Training verify failed', e);
    return NextResponse.json({ ok: true, active: false, name: signup.name, weeklyUsd: signup.weeklyUsd ?? 100 });
  }
}
