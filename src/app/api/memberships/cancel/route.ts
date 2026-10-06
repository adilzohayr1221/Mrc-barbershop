import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { getMembershipById, syncMembershipFromStripe } from '@/lib/membership';

export const dynamic = 'force-dynamic';

// Customer-only: cancel (or resume) one of the customer's plans at the end
// of the current period. Body: { membershipId, action: 'cancel' | 'resume' }.
// Weekly haircuts already paid for stay usable until the period ends.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const membershipId = body?.membershipId;
  const action = body?.action === 'resume' ? 'resume' : 'cancel';
  if (typeof membershipId !== 'string' || !membershipId) {
    return NextResponse.json({ error: 'Pick which plan.' }, { status: 400 });
  }
  const membership = await getMembershipById(membershipId);
  if (!membership || membership.customerId !== session.customerId) {
    return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });
  }
  try {
    await getStripe().subscriptions.update(membership.stripeSubscriptionId, {
      cancel_at_period_end: action === 'cancel',
    });
    const synced = await syncMembershipFromStripe(membership);
    return NextResponse.json({ ok: true, cancelAtPeriodEnd: synced?.cancelAtPeriodEnd ?? (action === 'cancel') });
  } catch (e) {
    console.error('Membership cancel failed', e);
    return NextResponse.json({ error: 'Could not update the plan. Please try again.' }, { status: 502 });
  }
}
