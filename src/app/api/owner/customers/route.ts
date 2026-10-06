import { NextResponse } from 'next/server';
import { getCustomers } from '@/lib/store';
import { requireOwner } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Owner-only: list customer accounts (public fields only — never passwordHash).
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const customers = await getCustomers();
  return NextResponse.json({
    customers: customers
      .map((c) => ({ id: c.id, name: c.name, email: c.email, createdAt: c.createdAt }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
}
