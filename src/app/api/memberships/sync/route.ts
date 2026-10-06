import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import { getMembershipBySubscriptionId, saveMembership, newId } from '@/lib/store';
import { ensureStripeCustomer, syncMembershipFromStripe, subscriptionPeriod } from '@/lib/membership';
import type { Membership } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Customer-only: reconcile the local membership doc from Stripe after
// Checkout (no webhooks — the client calls this on return).
// Picks the customer's newest 'membership' subscription.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 503 });
  }
  const session = requireCustomer(req);
  if (!session || !session.customerId) {
    return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  }
  try {
    const stripeCustomerId = await ensureStripeCustomer(session.customerId);
    const subs = await getStripe().subscriptions.list({ customer: stripeCustomerId, limit: 10 });
    const mine = subs.data
      .filter((s) => s.metadata?.kind === 'membership')
      .sort((a, b) => b.created - a.created)[0];
    if (!mine) {
      return NextResponse.json({ error: 'No subscription found. If you just paid, wait a moment and try again.' }, { status: 404 });
    }
    if (mine.metadata?.customerId && mine.metadata.customerId !== session.customerId) {
      return NextResponse.json({ error: 'Subscription does not belong to this account.' }, { status: 403 });
    }
    let membership = await getMembershipBySubscriptionId(mine.id);
    if (membership && membership.customerId !== session.customerId) {
      return NextResponse.json({ error: 'Subscription does not belong to this account.' }, { status: 403 });
    }
    if (!membership) {
      const { start, end } = subscriptionPeriod(mine);
      const isCustom = mine.metadata?.planKind === 'custom';
      let weeklyServices: Membership['weeklyServices'];
      let planPriceUsd: number | undefined;
      if (isCustom) {
        try {
          const parsed = JSON.parse(mine.metadata?.weeklyServices || '[]');
          if (Array.isArray(parsed) && parsed.length === 4) weeklyServices = parsed;
        } catch {}
        const p = Number(mine.metadata?.planPriceUsd);
        if (p > 0) planPriceUsd = p;
      }
      membership = {
        id: newId(),
        customerId: session.customerId,
        stripeSubscriptionId: mine.id,
        stripeCustomerId,
        status: 'active',
        currentPeriodStart: start.toISOString(),
        currentPeriodEnd: end.toISOString(),
        cancelAtPeriodEnd: mine.cancel_at_period_end,
        createdAt: new Date().toISOString(),
        qrToken: null,
        qrTokenExpiry: null,
        ...(isCustom ? { planKind: 'custom' as const, planPriceUsd, weeklyServices } : {}),
      } satisfies Membership;
      await saveMembership(membership);
    }
    const synced = await syncMembershipFromStripe(membership);
    return NextResponse.json({ ok: true, status: synced?.status ?? 'unknown' });
  } catch (e) {
    console.error('Membership sync failed', e);
    return NextResponse.json({ error: 'Could not sync the subscription. Please try again.' }, { status: 502 });
  }
}
