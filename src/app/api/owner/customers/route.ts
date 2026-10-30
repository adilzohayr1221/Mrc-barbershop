import { NextResponse } from 'next/server';
import { getCustomers } from '@/lib/store';

import { requireActiveOwner } from "@/lib/guard";

export const dynamic = 'force-dynamic';

// Owner-only: list customer accounts (public fields only — never passwordHash).
export async function GET(req: Request) {
  if (!(await requireActiveOwner(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const customers = await getCustomers();
  return NextResponse.json({
    customers: customers
      .map((c) => ({ id: c.id, name: c.name, email: c.email, createdAt: c.createdAt }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
}
