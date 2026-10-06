import { NextResponse } from 'next/server';
import { getCustomer, saveCustomer } from '@/lib/store';
import { requireCustomer, verifyPassword, hashPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Customer-only: change your own password. Requires the current password.
export async function POST(req: Request) {
  const session = requireCustomer(req);
  if (!session || !session.customerId)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const { currentPassword, newPassword } = body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < 6)
    return NextResponse.json({ error: 'New password must be at least 6 characters.' }, { status: 400 });
  if (newPassword === currentPassword)
    return NextResponse.json({ error: 'New password must be different from the current one.' }, { status: 400 });

  const customer = await getCustomer(session.customerId);
  if (!customer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (typeof currentPassword !== 'string' || !verifyPassword(currentPassword, customer.passwordHash))
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 403 });

  customer.passwordHash = hashPassword(newPassword);
  await saveCustomer(customer);
  return NextResponse.json({ ok: true });
}
