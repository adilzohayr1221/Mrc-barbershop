import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { deletePartnerLead } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Owner: delete a partner lead.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!requireOwner(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await deletePartnerLead(id);
  return NextResponse.json({ ok: true });
}
