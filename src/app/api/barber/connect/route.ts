import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { getBarbers, saveBarbers } from '@/lib/store';
import { requireBarber } from '@/lib/auth';
import { refreshConnectStatus } from '@/lib/payouts';

export const dynamic = 'force-dynamic';

function baseUrl(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  return `${proto}://${host}`;
}

// Barber starts (or resumes) Stripe Connect onboarding to link their bank.
// We create a Connect account (Accounts v2) and return Stripe's secure
// onboarding URL — the barber enters bank details on Stripe's site, never in our app.
export async function POST(req: Request) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === session.barberId);
  if (!barber) return NextResponse.json({ error: 'Barber not found.' }, { status: 404 });

  try {
    if (!barber.stripeAccountId) {
      // Accounts v2: no `type` field. The barber is a recipient (receives
      // transfers). The barber pays the transfer fees (deducted by Stripe);
      // Stripe covers losses.
      const account = await getStripe().v2.core.accounts.create({
        contact_email: barber.email || undefined,
        display_name: barber.name,
        dashboard: 'express',
        identity: {
          country: 'us',
          entity_type: 'individual',
        },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: {
                stripe_transfers: { requested: true },
              },
            },
          },
        },
        defaults: {
          currency: 'usd',
          responsibilities: {
            fees_collector: 'stripe',
            losses_collector: 'stripe',
          },
        },
      });
      barber.stripeAccountId = account.id;
      barber.payoutsEnabled = false;
      await saveBarbers(barbers);
    }

    const base = baseUrl(req);
    const link = await getStripe().v2.core.accountLinks.create({
      account: barber.stripeAccountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          refresh_url: `${base}/barber/dashboard?payouts=refresh`,
          return_url: `${base}/barber/dashboard?payouts=done`,
        },
      },
    });
    return NextResponse.json({ ok: true, url: link.url });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Could not start onboarding.';
    console.error('[connect] onboard failed', msg);
    // Don't leak raw Stripe API text to the barber — show a friendly message.
    return NextResponse.json(
      { error: 'Could not connect to the bank setup right now. Please try again in a moment.' },
      { status: 500 }
    );
  }
}

// Check the barber's Connect onboarding status.
export async function GET(req: Request) {
  const session = requireBarber(req);
  if (!session?.barberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const barbers = await getBarbers();
  const barber = barbers.find((b) => b.id === session.barberId);
  if (!barber) return NextResponse.json({ error: 'Barber not found.' }, { status: 404 });
  if (!barber.stripeAccountId) {
    return NextResponse.json({ connected: false, payoutsEnabled: false });
  }

  try {
    const status = await refreshConnectStatus(barber.id);
    return NextResponse.json({
      connected: true,
      payoutsEnabled: status.payoutsEnabled,
      detailsSubmitted: status.detailsSubmitted,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Could not check status.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
