import { NextResponse } from 'next/server';
import { getCustomer } from '@/lib/store';
import { deleteCustomerAccountCompletely } from '@/lib/customerLifecycle';

import { requireActiveOwner } from "@/lib/guard";

export const dynamic = 'force-dynamic';

// Owner-only: permanently delete a customer account. Runs the SAME
// complete lifecycle as the customer's self-delete (audit M7/M8,
// 2026-10-29): subscriptions cancelled, Stripe customer + saved payment
// methods dropped, personal photos/chats/push subscriptions deleted.
// Unlike self-delete, a failed subscription cancellation FAILS LOUDLY
// here — the delete is refused (502) so a live billing subscription is
// never orphaned. Their past bookings stay in the records (name/phone
// snapshots), but the account can no longer log in and the same email
// becomes free to register again.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireActiveOwner(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const customer = await getCustomer(id);
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const result = await deleteCustomerAccountCompletely(customer, { failLoudly: true });
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Could not cancel this customer\'s subscription(s) in Stripe — the account was NOT deleted. Cancel them in the Stripe dashboard, then try again.' },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}
