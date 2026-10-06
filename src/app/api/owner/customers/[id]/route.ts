import { NextResponse } from 'next/server';
import { deleteCustomer } from '@/lib/store';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Owner-only: permanently delete a customer account. Their past bookings stay
// in the records (name/phone snapshots), but the account can no longer log in
// and the same email becomes free to register again.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  await deleteCustomer(id);
  return NextResponse.json({ ok: true });
}
