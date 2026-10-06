import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { listPartnerLeads } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Owner: list partner leads (barbershop owners asking for their own app).
export async function GET(req: Request) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ leads: await listPartnerLeads() });
}
