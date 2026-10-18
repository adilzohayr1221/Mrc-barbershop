import { NextResponse } from 'next/server';
import { requireCustomer } from '@/lib/auth';
import { getCustomer, deleteCustomer, getMembershipsByCustomer } from '@/lib/store';
import { isStripeConfigured, getStripe } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

// Customer-initiated permanent account deletion (App Store guideline
// 5.1.1(v): apps that support account creation must offer account
// deletion). Any live plan is cancelled with Stripe first so a deleted
// account is never charged again; then the customer record itself is
// removed, which frees the email and ends every session's usefulness.
// Past bookings remain in the shop's business records — the same rule the
// owner-side customer deletion already follows.
export async function DELETE(req: Request) {
  const session = requireCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = await getCustomer(session.customerId);
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    if (isStripeConfigured()) {
      const memberships = await getMembershipsByCustomer(c.id);
      for (const m of memberships) {
        if (m.stripeSubscriptionId && (m.status === 'active' || m.status === 'past_due')) {
          await getStripe().subscriptions.cancel(m.stripeSubscriptionId).catch(() => {});
        }
      }
    }
  } catch {
    // Best effort only — the account deletion itself must still go through.
  }

  await deleteCustomer(c.id);
  return NextResponse.json({ ok: true });
}
