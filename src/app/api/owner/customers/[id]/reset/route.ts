import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getCustomer, saveCustomer } from '@/lib/store';
import { requireOwner, hashPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Unambiguous alphabet (no 0/O, 1/l/I) for a readable temporary password.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function tempPassword(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

// Owner-only: reset a customer's password to a one-time temporary password.
// The temp password is returned ONCE — the owner shares it with the customer,
// who should then change it from their own account.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const customer = await getCustomer(id);
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const temp = tempPassword();
  customer.passwordHash = hashPassword(temp);
  await saveCustomer(customer);
  return NextResponse.json({ ok: true, tempPassword: temp, email: customer.email, name: customer.name });
}
