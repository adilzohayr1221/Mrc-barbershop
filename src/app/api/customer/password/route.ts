import { NextResponse } from 'next/server';
import { getCustomer, saveCustomer } from '@/lib/store';
import { verifyPassword, hashPassword } from "@/lib/auth";
import { requireActiveCustomer } from "@/lib/guard";

export const dynamic = 'force-dynamic';

// Customer-only: change your own password. Requires the current password.
export async function POST(req: Request) {
  const session = await requireActiveCustomer(req);
  if (!session || !session.customerId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { currentPassword, newPassword } = body ?? {};
  // Audit M11 (2026-10-29): new passwords are at least 8 characters (was 6).
  if (typeof newPassword !== 'string' || newPassword.length < 8)
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });
  if (newPassword === currentPassword)
    return NextResponse.json({ error: 'New password must be different from the current one.' }, { status: 400 });

  const customer = await getCustomer(session.customerId);
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, customer.passwordHash))
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 403 });

  customer.passwordHash = hashPassword(newPassword);
  // Audit M7: bump the auth version so every OTHER session for this
  // account is revoked (this session's token goes stale too — the client
  // signs in again with the new password).
  customer.authVersion = (customer.authVersion ?? 0) + 1;
  await saveCustomer(customer);
  return NextResponse.json({ ok: true });
}
