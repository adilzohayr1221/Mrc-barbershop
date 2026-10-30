import { NextResponse } from 'next/server';

import { requireActiveCustomer } from "@/lib/guard";
import { getCustomer } from '@/lib/store';
import { deleteCustomerAccountCompletely } from '@/lib/customerLifecycle';

export const dynamic = 'force-dynamic';

// Customer-initiated permanent account deletion (App Store guideline
// 5.1.1(v): apps that support account creation must offer account
// deletion). Audit M7/M8 (2026-10-29): deletion now runs the complete
// lifecycle — live plans are cancelled with Stripe first so a deleted
// account is never charged again, the Stripe customer + saved payment
// methods are dropped, personal photo blobs (profile, discount ID,
// complaints), chat threads and push subscriptions are deleted, and the
// email claim is released. Financial records (bookings, gifts,
// memberships) are retained as business records — see the retention note
// in lib/customerLifecycle.ts. Cancellation here is best-effort: the
// deletion itself must still go through (App Store rule), and any
// failure is logged server-side.
export async function DELETE(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session?.customerId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const c = await getCustomer(session.customerId);
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await deleteCustomerAccountCompletely(c, { failLoudly: false });
  return NextResponse.json({ ok: true });
}
