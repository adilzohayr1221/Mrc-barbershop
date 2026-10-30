import { NextResponse } from 'next/server';
import { isStripeConfigured, getStripe } from '@/lib/stripe';
import {
  claimOnce, releaseClaim, listBookings, saveBooking, getMembershipBySubscriptionId,
} from '@/lib/store';
import { getTrainingSignupBySession, saveTrainingSignup } from '@/lib/training';
import { syncMembershipFromStripe } from '@/lib/membership';
import type Stripe from 'stripe';

export const dynamic = 'force-dynamic';

// Stripe webhook (audit H4, 2026-10-22). Until now the app had NO webhook:
// subscriptions and training signups synced only when the customer happened
// to return to the app and trigger a verify/sync call, so a paid signup
// whose tab closed stayed "pending" forever.
//
// Signature policy (per the audit): when STRIPE_WEBHOOK_SECRET is set, the
// signature is verified with constructEvent and a bad signature is a 400.
// When the secret is NOT configured yet, the endpoint degrades safely: the
// payload is treated as an untrusted hint — every handler re-fetches the
// object from the Stripe API and acts only on the re-fetched state, never
// on payload fields. Existing verify-on-return flows are untouched.
//
// Processed event ids are recorded via claims (data/claims/stripe-event-*),
// which doubles as the processed-events log and makes redeliveries no-ops.
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 });
  }
  const rawBody = await req.text();
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  if (secret) {
    const sig = req.headers.get('stripe-signature');
    if (!sig) return NextResponse.json({ error: 'Missing signature.' }, { status: 400 });
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (e) {
      console.error('[webhook] signature verification failed', e);
      return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
    }
  } else {
    console.warn('[webhook] STRIPE_WEBHOOK_SECRET not set — processing in re-fetch-only mode');
    try {
      event = JSON.parse(rawBody) as Stripe.Event;
    } catch {
      return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
    }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
      return NextResponse.json({ error: 'Invalid payload.' }, { status: 400 });
    }
  }

  const claimKey = `stripe-event-${event.id}`;
  if (!(await claimOnce(claimKey))) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handle(event);
  } catch (e) {
    // Let Stripe retry: release the claim so the redelivery reprocesses.
    await releaseClaim(claimKey);
    console.error('[webhook] handler failed', event.type, event.id, e);
    return NextResponse.json({ error: 'Handler failed.' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

async function handle(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  switch (event.type) {
    case 'checkout.session.completed': {
      const hint = event.data.object as Stripe.Checkout.Session;
      // Re-fetch: only the API copy is trusted.
      const session = await stripe.checkout.sessions.retrieve(hint.id);
      const kind = session.metadata?.kind;
      if (kind === 'training') {
        const signup = await getTrainingSignupBySession(session.id);
        if (signup && signup.status !== 'active' && session.payment_status === 'paid') {
          signup.status = 'active';
          signup.paidAt = new Date().toISOString();
          if (typeof session.subscription === 'string') signup.subscriptionId = session.subscription;
          if (typeof session.customer === 'string') signup.stripeCustomerId = session.customer;
          await saveTrainingSignup(signup);
          console.log('[webhook] training signup activated', signup.id);
        }
      } else if (kind === 'membership') {
        const subId = typeof session.subscription === 'string' ? session.subscription : null;
        if (subId) {
          const m = await getMembershipBySubscriptionId(subId);
          if (m) await syncMembershipFromStripe(m);
        }
      }
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId =
        typeof (invoice as unknown as { subscription?: unknown }).subscription === 'string'
          ? ((invoice as unknown as { subscription: string }).subscription)
          : null;
      if (subId) {
        const m = await getMembershipBySubscriptionId(subId);
        if (m) await syncMembershipFromStripe(m);
      }
      break;
    }
    case 'payment_intent.succeeded': {
      const pi = event.data.object as Stripe.PaymentIntent;
      console.log('[webhook] payment_intent.succeeded', pi.id, pi.metadata?.kind ?? '');
      break;
    }
    case 'charge.refunded':
    case 'charge.dispute.created': {
      const hint = event.data.object as Stripe.Charge;
      const charge = await stripe.charges.retrieve(hint.id);
      const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
      if (!piId) break;
      const booking = (await listBookings()).find(
        (b) => b.paymentIntentId === piId || b.remainingPaymentIntentId === piId
      );
      if (booking && (booking.payoutTransferId || (booking.payoutAmount ?? 0) > 0) && !booking.refundError) {
        // Money already reached the barber; a refund/dispute on top needs a
        // human to reconcile — flag it on the booking (owner-visible)
        // instead of silently absorbing it.
        booking.refundError =
          event.type === 'charge.refunded'
            ? 'Stripe reported a refund on a booking that was already paid out to the barber — reconcile manually.'
            : 'Stripe reported a payment dispute on a booking that was already paid out to the barber — reconcile manually.';
        await saveBooking(booking);
        console.warn('[webhook] refund/dispute on paid-out booking', booking.id, event.type);
      }
      break;
    }
    default:
      // Unhandled event types are acknowledged and ignored.
      break;
  }
}
